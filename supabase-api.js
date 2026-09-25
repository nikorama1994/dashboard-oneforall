(function(){
  'use strict';

  const cfg=window.NCT_SUPABASE_CONFIG||{};
  // Data operasional tidak lagi disimpan sebagai satu shared JSON.
  // Semua record disimpan per-row di public.operational_records.
  const SHARED_KEYS=[];

  const OPERATIONAL_CACHE_KEYS={
    production:'giling_dashboard_2026_v4_clean',
    initial_stock:'giling_initial_stocks_v2',
    ntm_waste:'ntm_waste_2026_v2',
    quality_incoming:'quality_incoming_tobacco_v1',
    quality_giling:'qgg_quality_sampling_progress_v1'
  };

  const OPERATIONAL_MODULES=Object.keys(OPERATIONAL_CACHE_KEYS);
  const VERSION_SESSION_KEY='nct_operational_versions_v2';
  let operationalVersions={};

  function loadOperationalVersions(){
    try{
      const x=JSON.parse(sessionStorage.getItem(VERSION_SESSION_KEY)||'{}');
      operationalVersions=x&&typeof x==='object'?x:{};
    }catch(_){operationalVersions={};}
    return operationalVersions;
  }

  function saveOperationalVersions(){
    try{sessionStorage.setItem(VERSION_SESSION_KEY,JSON.stringify(operationalVersions))}catch(_){}
  }

  function versionId(module,key){return String(module)+'|'+String(key)}

  function getOperationalVersion(module,key){
    if(!operationalVersions || typeof operationalVersions!=='object')loadOperationalVersions();
    return Number(operationalVersions[versionId(module,key)]||0);
  }

  function setOperationalVersion(module,key,version){
    if(!operationalVersions || typeof operationalVersions!=='object')loadOperationalVersions();
    const id=versionId(module,key);
    if(version===null || version===undefined) delete operationalVersions[id];
    else operationalVersions[id]=Number(version)||0;
    saveOperationalVersions();
  }
  const STATE_KEY='main';
  let client=null;
  let autoSyncInstalled=false;
  let syncTimer=null;
  let syncInFlight=false;
  let queuedSync=false;
  let stateCallback=null;

  function assertConfigured(){
    const url=String(cfg.url||'');
    const key=String(cfg.publishableKey||'');
    if(!url || url.includes('PASTE_') || !/^https:\/\//i.test(url)){
      throw new Error('Isi SUPABASE PROJECT URL di file supabase-config.js terlebih dahulu.');
    }
    if(!key || key.includes('PASTE_')){
      throw new Error('Isi SUPABASE PUBLISHABLE KEY di file supabase-config.js terlebih dahulu.');
    }
    if(!window.supabase || typeof window.supabase.createClient!=='function'){
      throw new Error('Library Supabase gagal dimuat. Periksa koneksi internet/CDN.');
    }
    return true;
  }

  function getClient(){
    assertConfigured();
    if(!client){
      client=window.supabase.createClient(cfg.url,cfg.publishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
    }
    return client;
  }

  async function getCurrentContext(){
    const sb=getClient();
    const {data:userData,error:userError}=await sb.auth.getUser();
    if(userError || !userData || !userData.user) return null;
    const user=userData.user;
    const {data:profile,error:profileError}=await sb.from('profiles').select('id,email,username,name,role,status,requested_role,approval_status,approved_at').eq('id',user.id).maybeSingle();
    if(profileError) throw profileError;
    if(!profile) return null;
    return {user,profile};
  }

  function snapshotLocalState(){
    const payload={};
    SHARED_KEYS.forEach(function(key){
      const value=localStorage.getItem(key);
      if(value!==null) payload[key]=value;
    });
    return payload;
  }

  function applyPayload(payload){
    payload=payload&&typeof payload==='object'?payload:{};
    SHARED_KEYS.forEach(function(key){
      if(Object.prototype.hasOwnProperty.call(payload,key) && payload[key]!==null && payload[key]!==undefined){
        localStorage.setItem(key,String(payload[key]));
      }else{
        localStorage.removeItem(key);
      }
    });
  }


  function parseConflictError(error){
    const message=String(error?.message||error||'');
    if(!message.includes('NCT_CONFLICT|'))return null;
    const tail=message.slice(message.indexOf('NCT_CONFLICT|'));
    const parts=tail.split('|');
    return {
      module:parts[1]||'',
      recordKey:parts[2]||'',
      currentVersion:Number(String(parts[3]||'0').replace(/[^0-9]/g,''))||0
    };
  }

  function operationalRecordKey(module,row){
    row=row&&typeof row==='object'?row:{};
    if(module==='production'){
      const d=String(row.date||'').slice(0,10);
      const b=String(row.brand||'').trim();
      return d&&b?d+'|'+b:'';
    }
    if(module==='initial_stock'){
      return String(row.brand||row.key||'').trim();
    }
    if(module==='ntm_waste'){
      const d=String(row.date||'').slice(0,10);
      const b=String(row.brand||'').trim();
      const t=String(row.type||'ambri').trim()||'ambri';
      return d&&b?d+'|'+b+'|'+t:'';
    }
    if(module==='quality_incoming'){
      return String(row.id||row.sourceKey||'').trim() ||
        [row.tobaccoDate,row.brand,row.tobaccoSeries].map(v=>String(v||'').trim()).join('|');
    }
    if(module==='quality_giling'){
      return String(row.key||'').trim() ||
        [row.date,row.mode,row.unit,row.samplingNo].map(v=>String(v||'').trim()).join('|');
    }
    return '';
  }

  function localCacheToRecords(module){
    const cacheKey=OPERATIONAL_CACHE_KEYS[module];
    if(!cacheKey)return [];

    try{
      const raw=JSON.parse(localStorage.getItem(cacheKey)||(
        module==='initial_stock'?'{}':'[]'
      ));

      if(module==='initial_stock'){
        const obj=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
        return Object.keys(obj).map(function(brand){
          return {brand,value:obj[brand]};
        });
      }

      return Array.isArray(raw)?raw:[];
    }catch(_){
      return [];
    }
  }

  function recordsToLocalCache(module,records){
    const cacheKey=OPERATIONAL_CACHE_KEYS[module];
    if(!cacheKey)return;

    window.__NCT_OPERATIONAL_APPLYING=(window.__NCT_OPERATIONAL_APPLYING||0)+1;
    try{
      if(module==='initial_stock'){
        const obj={};
        (records||[]).forEach(function(row){
          const p=row?.payload||row||{};
          const brand=String(p.brand||row?.record_key||'').trim();
          if(brand)obj[brand]=p.value;
        });
        localStorage.setItem(cacheKey,JSON.stringify(obj));
      }else{
        const arr=(records||[]).map(function(row){return row?.payload||row}).filter(Boolean);
        localStorage.setItem(cacheKey,JSON.stringify(arr));
      }
    }finally{
      window.__NCT_OPERATIONAL_APPLYING=Math.max(0,(window.__NCT_OPERATIONAL_APPLYING||1)-1);
    }
  }

  async function fetchOperationalModule(module){
    module=String(module||'');
    if(!OPERATIONAL_MODULES.includes(module))throw new Error('Module operasional tidak valid.');
    const sb=getClient();
    const {data,error}=await sb
      .from('operational_records')
      .select('module,record_key,payload,version,created_at,updated_at,created_by,updated_by')
      .eq('module',module)
      .order('updated_at',{ascending:true});
    if(error)throw error;

    (data||[]).forEach(function(row){
      setOperationalVersion(module,row.record_key,row.version);
    });
    return data||[];
  }

  async function fetchOperationalRecord(module,recordKey){
    const sb=getClient();
    const {data,error}=await sb
      .from('operational_records')
      .select('module,record_key,payload,version,created_at,updated_at,created_by,updated_by')
      .eq('module',module)
      .eq('record_key',recordKey)
      .maybeSingle();
    if(error)throw error;
    if(data)setOperationalVersion(module,recordKey,data.version);
    return data||null;
  }

  async function saveOperationalRecord(module,recordKey,payload,expectedVersion){
    const context=await getCurrentContext();
    if(!context)throw new Error('Sesi login tidak ditemukan.');
    const role=String(context.profile.role||'').toLowerCase();
    if(!['admin','qc_inspector'].includes(role)){
      throw new Error('Hanya Admin atau QC Inspector yang boleh menyimpan data.');
    }

    module=String(module||'');
    recordKey=String(recordKey||'');
    const expected=expectedVersion===undefined
      ? getOperationalVersion(module,recordKey)
      : Number(expectedVersion||0);

    const sb=getClient();
    const {data,error}=await sb.rpc('save_operational_record',{
      p_module:module,
      p_record_key:recordKey,
      p_payload:payload||{},
      p_expected_version:expected
    });

    if(error){
      const conflict=parseConflictError(error);
      if(conflict){
        const e=new Error('Data sudah diubah user lain.');
        e.code='NCT_CONFLICT';
        e.conflict=conflict;
        throw e;
      }
      throw error;
    }

    const row=Array.isArray(data)?data[0]:data;
    if(row){
      setOperationalVersion(module,recordKey,row.version);
      sessionStorage.setItem('nct_remote_updated_at',row.updated_at||new Date().toISOString());
    }
    return row||null;
  }

  async function deleteOperationalRecord(module,recordKey,expectedVersion){
    const context=await getCurrentContext();
    if(!context)throw new Error('Sesi login tidak ditemukan.');
    const role=String(context.profile.role||'').toLowerCase();
    if(!['admin','qc_inspector'].includes(role)){
      throw new Error('Hanya Admin atau QC Inspector yang boleh menghapus data.');
    }

    const expected=expectedVersion===undefined
      ? getOperationalVersion(module,recordKey)
      : Number(expectedVersion||0);

    const sb=getClient();
    const {data,error}=await sb.rpc('delete_operational_record',{
      p_module:String(module||''),
      p_record_key:String(recordKey||''),
      p_expected_version:expected
    });

    if(error){
      const conflict=parseConflictError(error);
      if(conflict){
        const e=new Error('Data sudah diubah user lain.');
        e.code='NCT_CONFLICT';
        e.conflict=conflict;
        throw e;
      }
      throw error;
    }

    setOperationalVersion(module,recordKey,null);
    sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString());
    return !!data;
  }

  async function seedOperationalModule(module,context){
    context=context||await getCurrentContext();
    const role=String(context?.profile?.role||'').toLowerCase();
    if(!['admin','qc_inspector'].includes(role))return [];

    const local=localCacheToRecords(module);
    const saved=[];
    for(const payload of local){
      const key=operationalRecordKey(module,payload);
      if(!key)continue;
      try{
        const row=await saveOperationalRecord(module,key,payload,0);
        if(row)saved.push(row);
      }catch(err){
        if(err?.code==='NCT_CONFLICT'){
          const remote=await fetchOperationalRecord(module,key);
          if(remote)saved.push(remote);
        }else{
          throw err;
        }
      }
    }
    return saved;
  }

  async function refreshOperationalModule(module){
    const rows=await fetchOperationalModule(module);
    recordsToLocalCache(module,rows);
    sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString());
    return rows;
  }

  async function prepareOperationalState(context){
    context=context||await getCurrentContext();
    if(!context)return null;

    loadOperationalVersions();
    const result={};

    for(const module of OPERATIONAL_MODULES){
      let rows=await fetchOperationalModule(module);

      // Quality lama sebelumnya hanya berada di browser lokal.
      // Jika tabel module masih kosong, user writer pertama dapat melakukan seed.
      if(!rows.length){
        const local=localCacheToRecords(module);
        if(local.length && ['admin','qc_inspector'].includes(String(context.profile.role||'').toLowerCase())){
          await seedOperationalModule(module,context);
          rows=await fetchOperationalModule(module);
        }
      }

      recordsToLocalCache(module,rows);
      result[module]=rows;
    }

    sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString());
    return result;
  }

  function subscribeOperationalChanges(callback){
    const sb=getClient();
    const channel=sb
      .channel('operational-records-live-v2')
      .on('postgres_changes',{
        event:'*',
        schema:'public',
        table:'operational_records'
      },function(payload){
        try{
          if(typeof callback==='function')callback(payload);
        }catch(err){console.error('Operational realtime callback error:',err)}
      })
      .subscribe();

    return function(){
      try{sb.removeChannel(channel)}catch(_){}
    };
  }

  async function fetchSharedState(){
    const sb=getClient();
    const {data,error}=await sb.from('dashboard_state').select('state_key,payload,updated_at,updated_by').eq('state_key',STATE_KEY).maybeSingle();
    if(error) throw error;
    return data||null;
  }

  async function pushSharedState(context){
    context=context||await getCurrentContext();
    if(!context) throw new Error('Sesi login tidak ditemukan.');
    {
      const role=String(context.profile.role||'').toLowerCase();
      if(!['admin','qc_inspector'].includes(role)) throw new Error('Hanya Admin atau QC Inspector yang boleh menyimpan data.');
    }
    const sb=getClient();
    const row={state_key:STATE_KEY,payload:snapshotLocalState(),updated_at:new Date().toISOString(),updated_by:context.user.id};
    const {data,error}=await sb.from('dashboard_state').upsert(row,{onConflict:'state_key'}).select('updated_at').single();
    if(error) throw error;
    if(data && data.updated_at) sessionStorage.setItem('nct_remote_updated_at',data.updated_at);
    return data;
  }

  async function prepareSharedState(context){
    context=context||await getCurrentContext();
    if(!context)return null;

    // V2: operational data comes from row-per-record tables.
    // dashboard_state remains only as legacy migration source.
    return await prepareOperationalState(context);
  }

  function emitState(state,meta){
    try{if(typeof stateCallback==='function')stateCallback(state,meta||null)}catch(_){ }
  }

  async function flushSync(){
    if(syncInFlight){queuedSync=true;return;}
    syncInFlight=true;queuedSync=false;emitState('saving');
    try{
      const saved=await pushSharedState();
      emitState('saved',saved||null);
    }catch(err){
      console.error('Supabase sync error:',err);emitState('error');
    }finally{
      syncInFlight=false;
      if(queuedSync) setTimeout(flushSync,250);
    }
  }

  function scheduleSync(){
    clearTimeout(syncTimer);
    syncTimer=setTimeout(flushSync,700);
  }

  function enableAutoSync(options){
    options=options||{};
    stateCallback=options.onState||stateCallback;
    // V2: multi-editor-safe.js melakukan sync per-record.
    emitState('saved');
  }

  async function refreshAndReload(){
    const data=await prepareOperationalState();
    try{
      document.dispatchEvent(new CustomEvent('nct-operational-refreshed',{detail:data||{}}));
    }catch(_){}
    return data;
  }

  async function signOut(){
    try{await getClient().auth.signOut()}finally{
      sessionStorage.removeItem('nct_remote_updated_at');
    }
  }

  function getLastSyncAt(){
    return sessionStorage.getItem('nct_remote_updated_at')||'';
  }

  async function updatePassword(newPassword){
    newPassword=String(newPassword||'');
    if(newPassword.length<8) throw new Error('Password baru minimal 8 karakter.');
    const sb=getClient();
    const {data:sessionData,error:sessionError}=await sb.auth.getSession();
    if(sessionError) throw sessionError;
    if(!sessionData || !sessionData.session) throw new Error('Sesi login tidak ditemukan. Silakan login kembali.');
    const {data,error}=await sb.auth.updateUser({password:newPassword});
    if(error) throw error;
    return data;
  }

  async function listAdminAccessRequests(){
    const context=await getCurrentContext();
    if(!context || String(context.profile.role||'').toLowerCase()!=='admin'){
      throw new Error('Hanya Admin yang dapat melihat permintaan akses.');
    }
    const sb=getClient();
    const {data,error}=await sb.rpc('list_admin_access_requests');
    if(error) throw error;
    return Array.isArray(data)?data:[];
  }

  async function approveAdminRequest(userId){
    userId=String(userId||'').trim();
    if(!userId) throw new Error('User ID tidak valid.');
    const sb=getClient();
    const {data,error}=await sb.rpc('approve_admin_request',{p_user_id:userId});
    if(error) throw error;
    return data;
  }

  async function rejectAdminRequest(userId){
    userId=String(userId||'').trim();
    if(!userId) throw new Error('User ID tidak valid.');
    const sb=getClient();
    const {data,error}=await sb.rpc('reject_admin_request',{p_user_id:userId});
    if(error) throw error;
    return data;
  }

  async function listUsers(){
    const context=await getCurrentContext();
    if(!context || String(context.profile.role||'').toLowerCase()!=='admin'){
      throw new Error('Hanya Admin yang dapat melihat daftar akun.');
    }
    const sb=getClient();
    const {data,error}=await sb.rpc('list_dashboard_users');
    if(error) throw error;
    return Array.isArray(data)?data:[];
  }

  async function updateUser(userId,patch){
    userId=String(userId||'').trim();
    patch=patch||{};
    if(!userId) throw new Error('User ID tidak valid.');
    const sb=getClient();
    const {data,error}=await sb.rpc('update_dashboard_user',{
      p_user_id:userId,
      p_name:String(patch.name||'').trim(),
      p_username:String(patch.username||'').trim(),
      p_role:String(patch.role||'guest_internal').toLowerCase(),
      p_status:String(patch.status||'active').toLowerCase()
    });
    if(error) throw error;
    return data;
  }

  async function deleteUser(userId){
    userId=String(userId||'').trim();
    if(!userId) throw new Error('User ID tidak valid.');

    const context=await getCurrentContext();
    if(!context || String(context.profile.role||'').toLowerCase()!=='admin'){
      throw new Error('Hanya Admin yang dapat menghapus akun.');
    }

    const sb=getClient();
    const {data,error}=await sb.rpc('delete_dashboard_user',{
      p_user_id:userId
    });

    if(error) throw error;
    return data===true || data===null ? true : data;
  }

  loadOperationalVersions();

  Object.defineProperty(window,'NCTSupabase',{value:{
    get client(){return getClient()},
    SHARED_KEYS,
    assertConfigured,
    getCurrentContext,
    OPERATIONAL_CACHE_KEYS,
    OPERATIONAL_MODULES,
    operationalRecordKey,
    getOperationalVersion,
    setOperationalVersion,
    fetchOperationalModule,
    fetchOperationalRecord,
    saveOperationalRecord,
    deleteOperationalRecord,
    refreshOperationalModule,
    prepareOperationalState,
    subscribeOperationalChanges,
    fetchSharedState,
    pushSharedState,
    prepareSharedState,
    enableAutoSync,
    refreshAndReload,
    getLastSyncAt,
    updatePassword,
    listAdminAccessRequests,
    approveAdminRequest,
    rejectAdminRequest,
    listUsers,
    updateUser,
    deleteUser,
    signOut
  },writable:false,configurable:false});
})();
