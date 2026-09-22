(function(){
  'use strict';

  const cfg=window.NCT_SUPABASE_CONFIG||{};
  const SHARED_KEYS=[
    'giling_dashboard_2026_v4_clean',
    'giling_initial_stocks_v2',
    'ntm_waste_2026_v2'
  ];
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
    const {data:profile,error:profileError}=await sb.from('profiles').select('id,email,name,role').eq('id',user.id).maybeSingle();
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

  async function fetchSharedState(){
    const sb=getClient();
    const {data,error}=await sb.from('dashboard_state').select('state_key,payload,updated_at,updated_by').eq('state_key',STATE_KEY).maybeSingle();
    if(error) throw error;
    return data||null;
  }

  async function pushSharedState(context){
    context=context||await getCurrentContext();
    if(!context) throw new Error('Sesi login tidak ditemukan.');
    if(String(context.profile.role||'').toLowerCase()!=='admin') throw new Error('Hanya Admin yang boleh menyimpan data.');
    const sb=getClient();
    const row={state_key:STATE_KEY,payload:snapshotLocalState(),updated_at:new Date().toISOString(),updated_by:context.user.id};
    const {data,error}=await sb.from('dashboard_state').upsert(row,{onConflict:'state_key'}).select('updated_at').single();
    if(error) throw error;
    if(data && data.updated_at) sessionStorage.setItem('nct_remote_updated_at',data.updated_at);
    return data;
  }

  async function prepareSharedState(context){
    context=context||await getCurrentContext();
    if(!context) return null;
    const remote=await fetchSharedState();
    if(remote){
      applyPayload(remote.payload);
      sessionStorage.setItem('nct_remote_updated_at',remote.updated_at||'');
      return remote;
    }
    // First installation: first Admin who logs in seeds Supabase using
    // existing dashboard data in this browser (if any).
    if(String(context.profile.role||'').toLowerCase()==='admin'){
      const created=await pushSharedState(context);
      sessionStorage.setItem('nct_remote_updated_at',created?.updated_at||'');
    }else{
      SHARED_KEYS.forEach(function(key){localStorage.removeItem(key)});
    }
    return null;
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
    options=options||{};stateCallback=options.onState||stateCallback;
    if(autoSyncInstalled) return;
    autoSyncInstalled=true;
    const nativeSet=Storage.prototype.setItem;
    const nativeRemove=Storage.prototype.removeItem;
    Storage.prototype.setItem=function(key,value){
      const result=nativeSet.call(this,key,value);
      try{if(this===window.localStorage && SHARED_KEYS.includes(String(key))) scheduleSync()}catch(_){ }
      return result;
    };
    Storage.prototype.removeItem=function(key){
      const result=nativeRemove.call(this,key);
      try{if(this===window.localStorage && SHARED_KEYS.includes(String(key))) scheduleSync()}catch(_){ }
      return result;
    };
    emitState('saved');
  }

  async function refreshAndReload(){
    const remote=await fetchSharedState();
    if(remote){
      applyPayload(remote.payload);
      sessionStorage.setItem('nct_remote_updated_at',remote.updated_at||'');
    }
    const url=new URL(window.location.href);
    url.searchParams.set('_nct_ready','1');
    window.location.replace(url.pathname+url.search+url.hash);
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

  Object.defineProperty(window,'NCTSupabase',{value:{
    get client(){return getClient()},
    SHARED_KEYS,
    assertConfigured,
    getCurrentContext,
    fetchSharedState,
    pushSharedState,
    prepareSharedState,
    enableAutoSync,
    refreshAndReload,
    getLastSyncAt,
    updatePassword,
    signOut
  },writable:false,configurable:false});
})();
