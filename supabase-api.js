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

  // V40: cache operasional besar tidak boleh menggagalkan login ketika
  // localStorage browser penuh. Format kompresi ini sama dengan dashboard.html.
  const NCT_CACHE_PREFIX='NCTZ1:';
  const NCT_SESSION_CACHE_PREFIX='nct_session_cache_v39:';
  const NCT_PREFER_SESSION_KEY='nct_prefer_session_cache_v40';
  const NCT_SIG_PREFIX='nct_operational_cache_sig_v40:';
  let nctPreferSession=false;
  try{nctPreferSession=sessionStorage.getItem(NCT_PREFER_SESSION_KEY)==='1'}catch(_){}
  const NCT_HEAVY_OPERATIONAL_KEYS=new Set([
    'giling_dashboard_2026_v4_clean',
    'qgg_quality_sampling_progress_v1'
  ]);

  function nctCompress(input){
    input=String(input??'');
    if(!input || typeof TextEncoder==='undefined')return '';
    const bytes=new TextEncoder().encode(input);
    if(!bytes.length)return '';
    const dict=new Map();
    const RESET=65535;
    let next=256;
    let w=String.fromCharCode(bytes[0]);
    const out=[];
    function codeOf(x){return x.length===1?x.charCodeAt(0):dict.get(x)}
    for(let i=1;i<bytes.length;i++){
      const k=String.fromCharCode(bytes[i]);
      const wk=w+k;
      if(dict.has(wk))w=wk;
      else{
        out.push(codeOf(w));
        if(next<RESET)dict.set(wk,next++);
        else{out.push(RESET);dict.clear();next=256}
        w=k;
      }
    }
    out.push(codeOf(w));
    const CHUNK=8192;
    let packed='';
    for(let i=0;i<out.length;i+=CHUNK)packed+=String.fromCharCode.apply(null,out.slice(i,i+CHUNK));
    return packed;
  }

  function nctDecompress(packed){
    packed=String(packed??'');
    if(!packed || typeof TextDecoder==='undefined')return '';
    const RESET=65535;
    let dict=[];
    let next=256;
    let old=null;
    const bytes=[];
    function emit(phrase){for(let j=0;j<phrase.length;j++)bytes.push(phrase.charCodeAt(j)&255)}
    for(let i=0;i<packed.length;i++){
      const code=packed.charCodeAt(i);
      if(code===RESET){dict=[];next=256;old=null;continue}
      let phrase;
      if(code<256)phrase=String.fromCharCode(code);
      else if(dict[code]!==undefined)phrase=dict[code];
      else if(code===next && old!==null)phrase=old+old.charAt(0);
      else throw new Error('Operational cache terkompresi tidak valid.');
      emit(phrase);
      if(old!==null && next<RESET)dict[next++]=old+phrase.charAt(0);
      old=phrase;
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  function nctDecodeCache(raw){
    if(typeof raw!=='string')return raw;
    return raw.startsWith(NCT_CACHE_PREFIX)
      ? nctDecompress(raw.slice(NCT_CACHE_PREFIX.length))
      : raw;
  }

  function nctEncodeCache(key,value){
    const text=String(value??'');
    if(!NCT_HEAVY_OPERATIONAL_KEYS.has(String(key)) || text.length<=256){
      return {text,stored:text,compressed:false};
    }
    try{
      const packed=nctCompress(text);
      if(packed && NCT_CACHE_PREFIX.length+packed.length<text.length){
        return {text,stored:NCT_CACHE_PREFIX+packed,compressed:true};
      }
    }catch(err){console.warn('Operational cache compression skipped:',key,err)}
    return {text,stored:text,compressed:false};
  }

  function nctReadOperationalCache(key){
    key=String(key);

    // V43 dashboard: seluruh database operasional hidup di RAM compatibility store.
    if(window.NCTMemoryStore?.isDatabaseKey?.(key)){
      try{return window.NCTMemoryStore.getItem(key)}catch(_){return null}
    }

    // Halaman login/index tidak perlu membuat cache database baru. Legacy lama
    // tetap boleh dibaca sekali sebagai sumber migrasi bila server masih kosong.
    try{
      const fallback=sessionStorage.getItem(NCT_SESSION_CACHE_PREFIX+key);
      if(fallback!==null)return nctDecodeCache(fallback);
    }catch(_){ }
    try{return nctDecodeCache(localStorage.getItem(key))}catch(_){return null}
  }

  function nctMarkPreferSession(){
    nctPreferSession=true;
    try{sessionStorage.setItem(NCT_PREFER_SESSION_KEY,'1')}catch(_){ }
  }

  function nctWriteOperationalCache(key,value){
    key=String(key);

    // V43 dashboard: cache kompatibilitas hanya RAM, tidak memakai quota browser.
    if(window.NCTMemoryStore?.isDatabaseKey?.(key)){
      window.NCTMemoryStore.setItem(key,String(value??''));
      return {mode:'memory',compressed:false};
    }

    // Di halaman login/index jangan hydrate ribuan record ke localStorage.
    // Dashboard akan mengambil ulang dari Supabase setelah navigasi selesai.
    return {mode:'skipped',compressed:false};
  }

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

  function localCacheToRecords(module,allowLegacy){
    const cacheKey=OPERATIONAL_CACHE_KEYS[module];
    if(!cacheKey)return [];

    try{
      let source=nctReadOperationalCache(cacheKey);
      // V43: cache legacy besar hanya didekompres bila Supabase module kosong
      // dan kita benar-benar membutuhkan sumber migrasi/seed.
      if(source===null && allowLegacy && window.NCTMemoryStore?.getLegacyItem){
        source=window.NCTMemoryStore.getLegacyItem(cacheKey);
      }
      const raw=JSON.parse(source||(module==='initial_stock'?'{}':'[]'));

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

  function operationalCacheSignature(module,records){
    const list=Array.isArray(records)?records:[];
    const last=list.length?list[list.length-1]:null;
    return [module,list.length,String(last?.updated_at||''),String(last?.version||'')].join('|');
  }

  function operationalCacheLooksPresent(module){
    const key=OPERATIONAL_CACHE_KEYS[module];
    if(!key)return false;
    try{return nctReadOperationalCache(key)!==null}catch(_){return false}
  }

  function recordsToLocalCache(module,records){
    const cacheKey=OPERATIONAL_CACHE_KEYS[module];
    if(!cacheKey)return false;

    const sig=operationalCacheSignature(module,records);

    // V51 PERSISTENCE FIX:
    // Jangan melewati hydration hanya karena signature di sessionStorage sama.
    // sessionStorage tetap hidup saat logout -> login, sedangkan NCTMemoryStore
    // dibuat ulang kosong pada page baru. Selain itu startup legacy memanggil
    // recalcStocks() yang dapat menulis [] ke RAM sebelum fetch Supabase selesai.
    // Akibatnya signature lama + cache RAM kosong pernah dianggap "sudah termuat".
    // Supabase adalah source of truth, jadi setiap fetch module selalu
    // dimaterialisasi kembali ke RAM compatibility store.

    window.__NCT_OPERATIONAL_APPLYING=(window.__NCT_OPERATIONAL_APPLYING||0)+1;
    try{
      if(module==='initial_stock'){
        const obj={};
        (records||[]).forEach(function(row){
          const p=row?.payload||row||{};
          const brand=String(p.brand||row?.record_key||'').trim();
          if(brand)obj[brand]=p.value;
        });
        nctWriteOperationalCache(cacheKey,JSON.stringify(obj));
      }else{
        const arr=(records||[]).map(function(row){return row?.payload||row}).filter(Boolean);
        nctWriteOperationalCache(cacheKey,JSON.stringify(arr));
      }
      try{sessionStorage.setItem(NCT_SIG_PREFIX+module,sig)}catch(_){ }
      if(Array.isArray(records) && records.length){
        try{window.NCTMemoryStore?.clearLegacyItem?.(cacheKey)}catch(_){ }
      }
      return true;
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

  // V50: satu engine bulk-replace untuk seluruh database operational_records.
  // Prinsip:
  //   1. Fetch snapshot module SATU KALI.
  //   2. Data manual/non-upload tidak pernah ditimpa.
  //   3. Record file baru disimpan paralel dengan version dari snapshot.
  //   4. Hanya jika benar-benar terjadi conflict, record itu saja yang di-fetch ulang.
  //   5. Record upload lama yang tidak ada di file baru dihapus.
  // Ini menyamakan Database 01 dan Database 03 sekaligus memangkas request Quality.
  async function replaceOperationalUpload(module,records,options){
    options=options||{};
    module=String(module||'');
    if(!OPERATIONAL_MODULES.includes(module))throw new Error('Module operasional tidak valid.');

    const sourceTag=String(options.sourceTag||'DATABASE_UPLOAD').toUpperCase();
    const poolLimit=Math.max(1,Math.min(Number(options.poolLimit)||6,12));
    const maxAttempts=Math.max(1,Math.min(Number(options.maxAttempts)||6,10));
    const onProgress=typeof options.onProgress==='function'?options.onProgress:null;
    const isUploadPayload=typeof options.isUploadPayload==='function'
      ? options.isUploadPayload
      : function(payload){
          return String(payload?.databaseUploadSource||'').toUpperCase()===sourceTag;
        };

    const context=await getCurrentContext();
    if(!context)throw new Error('Sesi login tidak ditemukan.');
    const role=String(context.profile.role||'').toLowerCase();
    if(!['admin','qc_inspector'].includes(role)){
      throw new Error('Hanya Admin atau QC Inspector yang boleh upload database.');
    }

    const incomingList=(Array.isArray(records)?records:[]).filter(Boolean);
    if(!incomingList.length)throw new Error('Tidak ada record valid untuk disimpan.');

    const incomingByKey=new Map();
    incomingList.forEach(function(payload){
      const copy={...(payload||{}),databaseUploadSource:sourceTag};
      const key=operationalRecordKey(module,copy);
      if(key)incomingByKey.set(String(key),copy);
    });
    if(!incomingByKey.size)throw new Error('Tidak ada record valid untuk disimpan.');

    const sb=getClient();
    const initial=await fetchOperationalModule(module);
    const initialByKey=new Map();
    const oldUploadKeys=new Set();
    (initial||[]).forEach(function(row){
      const key=String(row?.record_key||'');
      if(!key)return;
      initialByKey.set(key,row);
      if(isUploadPayload(row?.payload||{}))oldUploadKeys.add(key);
    });

    let saved=0,deleted=0,manualCollision=0,conflictRetries=0;
    let concurrentManualPreserved=0;
    let saveDone=0,deleteDone=0;
    const acceptedKeys=[];

    function emitProgress(phase,total){
      if(!onProgress)return;
      try{
        onProgress({
          module,sourceTag,phase,
          total:Number(total||0),
          completed:phase==='delete'?deleteDone:saveDone,
          saved,deleted,manualCollision,conflictRetries,concurrentManualPreserved
        });
      }catch(_){ }
    }
    function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
    function conflictError(error){
      const conflict=parseConflictError(error);
      if(!conflict)return null;
      const e=new Error('Data sudah diubah user lain.');
      e.code='NCT_CONFLICT';
      e.conflict=conflict;
      return e;
    }
    async function rpcSave(key,payload,expected){
      const {data,error}=await sb.rpc('save_operational_record',{
        p_module:module,
        p_record_key:key,
        p_payload:payload||{},
        p_expected_version:Number(expected||0)
      });
      if(error){const e=conflictError(error);if(e)throw e;throw error;}
      const row=Array.isArray(data)?data[0]:data;
      if(row)setOperationalVersion(module,key,row.version);
      return row||null;
    }
    async function rpcDelete(key,expected){
      const {data,error}=await sb.rpc('delete_operational_record',{
        p_module:module,
        p_record_key:key,
        p_expected_version:Number(expected||0)
      });
      if(error){const e=conflictError(error);if(e)throw e;throw error;}
      setOperationalVersion(module,key,null);
      return !!data;
    }
    async function runPool(items,worker,limit){
      const list=Array.from(items||[]);
      if(!list.length)return;
      let cursor=0;
      const count=Math.max(1,Math.min(Number(limit)||1,list.length));
      await Promise.all(Array.from({length:count},async function(){
        while(true){
          const i=cursor++;
          if(i>=list.length)return;
          await worker(list[i],i);
        }
      }));
    }

    const entries=Array.from(incomingByKey.entries());
    emitProgress('save',entries.length);
    await runPool(entries,async function(entry){
      const key=entry[0],payload=entry[1];
      const initialRow=initialByKey.get(key)||null;

      // Jika key di server sudah milik input manual/non-upload, upload tidak boleh menimpanya.
      if(initialRow && !isUploadPayload(initialRow.payload||{})){
        manualCollision++;
        saveDone++;
        emitProgress('save',entries.length);
        return;
      }

      let expected=initialRow?Number(initialRow.version||0):0;
      for(let attempt=1;attempt<=maxAttempts;attempt++){
        try{
          await rpcSave(key,payload,expected);
          saved++;
          acceptedKeys.push(key);
          saveDone++;
          emitProgress('save',entries.length);
          return;
        }catch(err){
          if(err?.code!=='NCT_CONFLICT'||attempt>=maxAttempts)throw err;
          conflictRetries++;

          // Fetch ulang HANYA key yang konflik. Bila sekarang sudah menjadi manual,
          // jangan ditimpa oleh bulk upload dari perangkat lain.
          const remote=await fetchOperationalRecord(module,key);
          if(remote && !isUploadPayload(remote.payload||{})){
            manualCollision++;
            concurrentManualPreserved++;
            saveDone++;
            emitProgress('save',entries.length);
            return;
          }
          expected=remote?Number(remote.version||0):0;
          await sleep(40*attempt);
        }
      }
    },poolLimit);

    const deleteKeys=Array.from(oldUploadKeys).filter(key=>!incomingByKey.has(key));
    emitProgress('delete',deleteKeys.length);
    await runPool(deleteKeys,async function(key){
      let row=initialByKey.get(key)||null;
      let expected=row?Number(row.version||0):0;
      for(let attempt=1;attempt<=maxAttempts;attempt++){
        if(row && !isUploadPayload(row.payload||{})){
          deleteDone++;
          emitProgress('delete',deleteKeys.length);
          return;
        }
        try{
          if(await rpcDelete(key,expected))deleted++;
          deleteDone++;
          emitProgress('delete',deleteKeys.length);
          return;
        }catch(err){
          if(err?.code!=='NCT_CONFLICT'||attempt>=maxAttempts)throw err;
          conflictRetries++;
          row=await fetchOperationalRecord(module,key);
          if(!row || !isUploadPayload(row.payload||{})){
            deleteDone++;
            emitProgress('delete',deleteKeys.length);
            return;
          }
          expected=Number(row.version||0);
          await sleep(40*attempt);
        }
      }
    },poolLimit);

    const finalRows=await fetchOperationalModule(module);
    recordsToLocalCache(module,finalRows);
    try{sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString())}catch(_){ }
    emitProgress('done',incomingByKey.size);

    return {
      saved,deleted,manualCollision,conflictRetries,concurrentManualPreserved,
      acceptedKeys,rows:finalRows
    };
  }

  async function replaceProductionUpload(records,options){
    options=options||{};
    const sourceTag=String(options.sourceTag||'GILING_GUNTING').toUpperCase();
    return replaceOperationalUpload('production',records,Object.assign({},options,{
      sourceTag,
      poolLimit:Number(options.poolLimit)||6,
      isUploadPayload:function(payload){
        payload=payload||{};
        return String(payload.databaseUploadSource||'').toUpperCase()===sourceTag ||
          String(payload.productionSource||'').toUpperCase()==='EXCEL' ||
          payload.ambriExcelSource===true;
      }
    }));
  }

  async function replaceQualityGilingUpload(records,options){
    options=options||{};
    const sourceTag=String(options.sourceTag||'QUALITY_GILING_GUNTING').toUpperCase();
    return replaceOperationalUpload('quality_giling',records,Object.assign({},options,{
      sourceTag,
      poolLimit:Number(options.poolLimit)||6,
      isUploadPayload:function(payload){
        return String(payload?.databaseUploadSource||'').toUpperCase()===sourceTag;
      }
    }));
  }


  // V47: hapus DATA HASIL UPLOAD database langsung di Supabase.
  // Master, akun, initial stock, Quality Incoming, dan input manual dipertahankan.
  async function purgeUploadedDatabaseData(){
    const context=await getCurrentContext();
    if(!context)throw new Error('Sesi login tidak ditemukan.');
    const role=String(context.profile.role||'').toLowerCase();
    if(role!=='admin')throw new Error('Hanya Admin yang boleh menghapus Database Upload.');

    function isGilingUpload(payload){
      payload=payload||{};
      return String(payload.databaseUploadSource||'').toUpperCase()==='GILING_GUNTING' ||
        String(payload.productionSource||'').toUpperCase()==='EXCEL' ||
        payload.ambriExcelSource===true;
    }
    function isNtmDerived(payload){
      return String(payload?.source||'').toUpperCase().startsWith('DATABASE 2026');
    }
    function isQualityUpload(payload){
      return String(payload?.databaseUploadSource||'').toUpperCase()==='QUALITY_GILING_GUNTING';
    }

    async function deleteOneFresh(module,key,maxAttempts){
      maxAttempts=maxAttempts||6;
      for(let attempt=1;attempt<=maxAttempts;attempt++){
        const remote=await fetchOperationalRecord(module,key);
        if(!remote)return false;
        try{
          await deleteOperationalRecord(module,key,Number(remote.version||0));
          return true;
        }catch(err){
          if(err?.code!=='NCT_CONFLICT' || attempt>=maxAttempts)throw err;
          await new Promise(r=>setTimeout(r,50*attempt));
        }
      }
      return false;
    }

    async function purgeModule(module,predicate){
      const rows=await fetchOperationalModule(module);
      const targets=(rows||[]).filter(row=>predicate(row?.payload||{},row));
      let deleted=0;
      let cursor=0;
      const workers=Math.max(1,Math.min(4,targets.length||1));
      await Promise.all(Array.from({length:workers},async function(){
        while(true){
          const i=cursor++;
          if(i>=targets.length)return;
          const row=targets[i];
          const key=String(row?.record_key||'');
          if(!key)continue;
          if(await deleteOneFresh(module,key,6))deleted++;
        }
      }));
      const finalRows=await fetchOperationalModule(module);
      recordsToLocalCache(module,finalRows);
      return {found:targets.length,deleted,remaining:finalRows.length};
    }

    const production=await purgeModule('production',isGilingUpload);
    const ntmWaste=await purgeModule('ntm_waste',isNtmDerived);
    const qualityGiling=await purgeModule('quality_giling',isQualityUpload);

    try{sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString())}catch(_){ }
    return {production,ntmWaste,qualityGiling};
  }

  async function refreshOperationalModule(module){
    const rows=await fetchOperationalModule(module);
    recordsToLocalCache(module,rows);
    sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString());
    return rows;
  }

  async function prepareOperationalModules(modules,context){
    context=context||await getCurrentContext();
    if(!context)return null;

    loadOperationalVersions();
    const requested=[...new Set((Array.isArray(modules)?modules:[]).map(String))]
      .filter(module=>OPERATIONAL_MODULES.includes(module));
    const result={};
    if(!requested.length)return result;

    const role=String(context.profile.role||'').toLowerCase();

    // V45: hanya module yang benar-benar dibutuhkan tab aktif yang diambil.
    // Antar-module tetap paralel supaya perpindahan pertama ke sebuah tab cepat.
    const fetched=await Promise.all(requested.map(async function(module){
      let rows=await fetchOperationalModule(module);
      if(!rows.length){
        // Legacy cache hanya disentuh bila Supabase module memang kosong.
        const local=localCacheToRecords(module,true);
        if(local.length && ['admin','qc_inspector'].includes(role)){
          await seedOperationalModule(module,context);
          rows=await fetchOperationalModule(module);
        }
      }
      return [module,rows];
    }));

    for(const pair of fetched){
      const module=pair[0], rows=pair[1];
      recordsToLocalCache(module,rows);
      result[module]=rows;
      // Beri browser kesempatan paint/input setelah materialisasi tiap module.
      await new Promise(resolve=>setTimeout(resolve,0));
    }

    try{sessionStorage.setItem('nct_remote_updated_at',new Date().toISOString())}catch(_){ }
    return result;
  }

  async function prepareOperationalState(context){
    // API kompatibilitas: Refresh Data / Backup masih boleh meminta semua module.
    return await prepareOperationalModules(OPERATIONAL_MODULES,context);
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

    // V42: halaman login tidak perlu download seluruh database hanya untuk
    // kemudian pindah ke dashboard. Hydration penuh dilakukan di dashboard.
    if(!window.NCTMemoryStore)return {};

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
      // V51: signature/version cache hanya optimasi tab. Jangan dibawa ke sesi
      // login berikutnya karena database RAM dibuat ulang saat dashboard dibuka.
      try{
        OPERATIONAL_MODULES.forEach(function(module){
          sessionStorage.removeItem(NCT_SIG_PREFIX+module);
        });
        sessionStorage.removeItem(VERSION_SESSION_KEY);
      }catch(_){ }
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

  async function createUser(input){
    input=input||{};

    const context=await getCurrentContext();
    if(!context || String(context.profile.role||'').toLowerCase()!=='admin'){
      throw new Error('Hanya Admin yang dapat membuat akun.');
    }

    const name=String(input.name||'').trim();
    const username=String(input.username||'').trim().toLowerCase();
    const role=String(input.role||'guest_internal').trim().toLowerCase();
    const status=String(input.status||'active').trim().toLowerCase();
    const password=String(input.password||'');

    if(name.length<2) throw new Error('Nama minimal 2 karakter.');
    if(!/^[a-z0-9._-]{3,32}$/.test(username)){
      throw new Error('Username harus 3–32 karakter: huruf kecil, angka, titik, underscore, atau tanda minus.');
    }
    if(password.length<8) throw new Error('Password sementara minimal 8 karakter.');
    if(!['admin','qc_inspector','guest_internal','guest_external'].includes(role)){
      throw new Error('Role tidak valid.');
    }
    if(!['active','inactive'].includes(status)){
      throw new Error('Status akun tidak valid.');
    }

    const email=username+'@dashboard.internal';

    // Gunakan client Supabase TERPISAH supaya signUp user baru
    // tidak mengganti session Admin yang sedang aktif.
    const tempClient=window.supabase.createClient(cfg.url,cfg.publishableKey,{
      auth:{
        persistSession:false,
        autoRefreshToken:false,
        detectSessionInUrl:false
      }
    });

    let newUserId='';

    try{
      const {data,error}=await tempClient.auth.signUp({
        email,
        password,
        options:{
          data:{
            username,
            name,
            requested_role:'viewer'
          }
        }
      });

      if(error) throw error;
      if(!data || !data.user) throw new Error('Supabase tidak mengembalikan user baru.');

      newUserId=String(data.user.id||'');
      if(!newUserId) throw new Error('User ID baru tidak tersedia.');

      // Sistem menggunakan email internal palsu.
      // Confirm Email harus OFF agar akun bisa langsung dipakai login.
      if(!data.session){
        try{
          await deleteUser(newUserId);
        }catch(_){}
        throw new Error('Akun tidak dibuat karena Confirm Email masih aktif. Matikan Confirm Email di Supabase Authentication terlebih dahulu.');
      }

      // Trigger Auth membuat profile awal sebagai viewer.
      // Setelah itu Admin menaikkan ke role/status yang dipilih.
      await updateUser(newUserId,{name,username,role,status});

      try{await tempClient.auth.signOut()}catch(_){}

      return {
        id:newUserId,
        email,
        username,
        name,
        role,
        status
      };

    }catch(err){
      // Kalau Auth user sudah tercipta tetapi tahap berikutnya gagal,
      // rollback supaya tidak meninggalkan akun setengah jadi.
      if(newUserId){
        try{await deleteUser(newUserId)}catch(_){}
      }
      try{await tempClient.auth.signOut()}catch(_){}
      throw err;
    }
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
    replaceOperationalUpload,
    replaceProductionUpload,
    replaceQualityGilingUpload,
    purgeUploadedDatabaseData,
    refreshOperationalModule,
    prepareOperationalModules,
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
    createUser,
    updateUser,
    deleteUser,
    signOut
  },writable:false,configurable:false});
})();
