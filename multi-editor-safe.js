(function(){
  'use strict';

  const PENDING_KEY='nct_operational_pending_v2';
  const CONFLICT_KEY='nct_operational_conflicts_v2';

  const cacheToModule={
    'giling_dashboard_2026_v4_clean':'production',
    'giling_initial_stocks_v2':'initial_stock',
    'ntm_waste_2026_v2':'ntm_waste',
    'quality_incoming_tobacco_v1':'quality_incoming',
    'qgg_quality_sampling_progress_v1':'quality_giling'
  };

  const nativeSet=Storage.prototype.setItem;
  const nativeRemove=Storage.prototype.removeItem;
  const recordQueues=new Map();
  const modulePending=new Map();
  let started=false;
  let unsubscribeRealtime=null;
  let retryTimer=null;
  let alertCooldown=0;

  function safeJson(raw,fallback){
    try{
      const x=JSON.parse(raw||'');
      return x===null||x===undefined?fallback:x;
    }catch(_){return fallback}
  }

  function cleanPayload(row){
    if(!row || typeof row!=='object')return row;
    const x=JSON.parse(JSON.stringify(row));
    delete x.__version;
    delete x.__sync_version;
    delete x.__updated_at;
    return x;
  }

  function rowKey(module,row){
    return window.NCTSupabase?.operationalRecordKey
      ? window.NCTSupabase.operationalRecordKey(module,row)
      : '';
  }

  function cacheRecords(module,raw){
    if(module==='initial_stock'){
      const obj=safeJson(raw,{});
      return Object.keys(obj||{}).map(function(brand){
        return {brand:brand,value:obj[brand]};
      });
    }
    const arr=safeJson(raw,[]);
    return Array.isArray(arr)?arr:[];
  }

  function toMap(module,raw){
    const map=new Map();
    cacheRecords(module,raw).forEach(function(row){
      const key=rowKey(module,row);
      if(key)map.set(key,cleanPayload(row));
    });
    return map;
  }

  function stable(value){
    try{return JSON.stringify(value,Object.keys(value||{}).sort())}
    catch(_){try{return JSON.stringify(value)}catch(__){return String(value)}}
  }

  function deepEqual(a,b){
    try{return JSON.stringify(a)===JSON.stringify(b)}catch(_){return false}
  }

  function loadPending(){
    const list=safeJson(localStorage.getItem(PENDING_KEY),[]);
    return Array.isArray(list)?list:[];
  }

  function savePending(list){
    window.__NCT_OPERATIONAL_APPLYING=(window.__NCT_OPERATIONAL_APPLYING||0)+1;
    try{nativeSet.call(localStorage,PENDING_KEY,JSON.stringify(list||[]))}
    finally{window.__NCT_OPERATIONAL_APPLYING=Math.max(0,(window.__NCT_OPERATIONAL_APPLYING||1)-1)}
  }

  function pendingId(module,key){return module+'|'+key}

  function upsertPending(op){
    const list=loadPending();
    const id=pendingId(op.module,op.recordKey);
    const idx=list.findIndex(x=>pendingId(x.module,x.recordKey)===id);
    if(idx>=0)list[idx]=op;else list.push(op);
    savePending(list);
    return op;
  }

  function removePending(module,key){
    const id=pendingId(module,key);
    savePending(loadPending().filter(x=>pendingId(x.module,x.recordKey)!==id));
  }

  function storeConflict(op,remote){
    const list=safeJson(localStorage.getItem(CONFLICT_KEY),[]);
    const next=Array.isArray(list)?list:[];
    next.unshift({
      module:op.module,
      recordKey:op.recordKey,
      action:op.action,
      attemptedPayload:op.payload||null,
      remotePayload:remote?.payload||null,
      remoteVersion:remote?.version||0,
      conflictAt:new Date().toISOString()
    });
    window.__NCT_OPERATIONAL_APPLYING=(window.__NCT_OPERATIONAL_APPLYING||0)+1;
    try{nativeSet.call(localStorage,CONFLICT_KEY,JSON.stringify(next.slice(0,50)))}
    finally{window.__NCT_OPERATIONAL_APPLYING=Math.max(0,(window.__NCT_OPERATIONAL_APPLYING||1)-1)}
  }

  function setSyncBadge(state,text){
    const el=document.getElementById('nctSyncBadge');
    if(!el)return;
    if(text)el.textContent=text;
    el.dataset.multiEditorState=state||'';
    if(state==='error'||state==='conflict')el.style.borderColor='#d36b7b';
    else if(state==='saving')el.style.borderColor='#d7b56f';
    else el.style.borderColor='';
  }

  function showNotice(message,type){
    const now=Date.now();
    if(type!=='conflict' && now-alertCooldown<2000)return;
    alertCooldown=now;

    let el=document.getElementById('nctMultiEditorNotice');
    if(!el){
      el=document.createElement('div');
      el.id='nctMultiEditorNotice';
      el.style.cssText=[
        'position:fixed','right:14px','bottom:14px','z-index:10050',
        'max-width:360px','padding:11px 13px','border-radius:11px',
        'font:800 9px/1.5 Inter,Segoe UI,Arial,sans-serif',
        'box-shadow:0 14px 35px rgba(0,0,0,.35)','backdrop-filter:blur(8px)'
      ].join(';');
      document.body.appendChild(el);
    }

    el.textContent=message;
    if(type==='conflict'){
      el.style.background='rgba(66,29,38,.96)';
      el.style.border='1px solid #a95669';
      el.style.color='#ffd5dd';
    }else if(type==='error'){
      el.style.background='rgba(63,45,24,.96)';
      el.style.border='1px solid #aa7b3e';
      el.style.color='#ffdda6';
    }else{
      el.style.background='rgba(19,63,56,.96)';
      el.style.border='1px solid #3a9b84';
      el.style.color='#b8f5e5';
    }

    clearTimeout(el.__hideTimer);
    el.__hideTimer=setTimeout(()=>el.remove(),type==='conflict'?12000:5000);
  }

  function updateRuntimeFromCaches(module){
    try{
      if(module==='production' && typeof data!=='undefined'){
        const arr=safeJson(localStorage.getItem('giling_dashboard_2026_v4_clean'),[]);
        if(Array.isArray(arr)){
          data.splice(0,data.length,...arr);
          if(typeof fillFilters==='function')fillFilters();
          if(typeof updateDashboard==='function')updateDashboard();
          if(typeof renderTable==='function')renderTable();
          if(typeof renderInputHistory==='function')renderInputHistory();
          if(typeof renderStock==='function')renderStock();
          if(typeof renderWastePage==='function')renderWastePage();
        }
      }

      if(module==='initial_stock' && typeof initialStocks!=='undefined'){
        const obj=safeJson(localStorage.getItem('giling_initial_stocks_v2'),{});
        initialStocks=obj&&typeof obj==='object'?obj:{};
        if(typeof renderStock==='function')renderStock();
      }

      if(module==='ntm_waste' && typeof ntmWasteData!=='undefined'){
        const arr=safeJson(localStorage.getItem('ntm_waste_2026_v2'),[]);
        if(Array.isArray(arr)){
          ntmWasteData.splice(0,ntmWasteData.length,...arr);
          if(typeof renderNtmWasteHistory==='function')renderNtmWasteHistory();
          if(typeof renderNtmWastePage==='function')renderNtmWastePage();
        }
      }

      if(module==='quality_incoming'){
        if(typeof qitFillBrandFilter==='function')qitFillBrandFilter();
        if(typeof qitFillSeriesFilter==='function')qitFillSeriesFilter();
        if(typeof renderQualityIncomingPage==='function')renderQualityIncomingPage();
      }

      if(module==='quality_giling'){
        try{if(typeof qggProgressCache!=='undefined')qggProgressCache=null}catch(_){}
        try{if(typeof invalidateQualityProgressCache==='function')invalidateQualityProgressCache()}catch(_){}
        if(typeof renderSamplingCompletion==='function')renderSamplingCompletion();
        if(typeof renderQualityHistory==='function')renderQualityHistory();
        if(typeof renderQualityTrendCards==='function')renderQualityTrendCards();
        if(typeof syncQualityInputState==='function')syncQualityInputState();
      }
    }catch(err){
      console.warn('Runtime refresh warning:',module,err);
    }
  }

  async function refreshModule(module,quiet){
    try{
      await window.NCTSupabase.refreshOperationalModule(module);
      updateRuntimeFromCaches(module);
      if(!quiet)showNotice('Data '+module+' sudah disinkronkan dengan Supabase.','ok');
      return true;
    }catch(err){
      console.error('Refresh module error:',err);
      if(!quiet)showNotice('Gagal mengambil data terbaru. Periksa koneksi internet.','error');
      return false;
    }
  }

  async function handleConflict(op){
    setSyncBadge('conflict','KONFLIK');

    let remote=null;
    try{
      remote=await window.NCTSupabase.fetchOperationalRecord(op.module,op.recordKey);
    }catch(_){}

    storeConflict(op,remote);
    removePending(op.module,op.recordKey);
    await refreshModule(op.module,true);

    showNotice(
      'Konflik dicegah: record yang sama sudah diubah user lain. Perubahan Anda TIDAK menimpa data server. Data terbaru sudah dimuat.',
      'conflict'
    );

    try{
      document.dispatchEvent(new CustomEvent('nct-operational-conflict',{
        detail:{operation:op,remote:remote}
      }));
    }catch(_){}
  }

  function queueOperation(op){
    const qid=pendingId(op.module,op.recordKey);
    upsertPending(op);

    const previous=recordQueues.get(qid)||Promise.resolve();

    const next=previous
      .catch(()=>{})
      .then(async function(){
        modulePending.set(op.module,(modulePending.get(op.module)||0)+1);
        setSyncBadge('saving','MENYIMPAN');

        try{
          if(op.action==='delete'){
            await window.NCTSupabase.deleteOperationalRecord(
              op.module,
              op.recordKey,
              window.NCTSupabase.getOperationalVersion(op.module,op.recordKey)
            );
          }else{
            await window.NCTSupabase.saveOperationalRecord(
              op.module,
              op.recordKey,
              op.payload,
              window.NCTSupabase.getOperationalVersion(op.module,op.recordKey)
            );
          }

          removePending(op.module,op.recordKey);
          setSyncBadge('saved','TERSIMPAN');
        }catch(err){
          if(err?.code==='NCT_CONFLICT'){
            await handleConflict(op);
          }else{
            console.error('Operational sync error:',err);
            // Pending op sengaja dipertahankan untuk retry.
            setSyncBadge('error','PENDING');
            showNotice('Perubahan tersimpan sementara di perangkat dan akan dicoba lagi saat koneksi tersedia.','error');
          }
        }finally{
          modulePending.set(op.module,Math.max(0,(modulePending.get(op.module)||1)-1));
        }
      })
      .finally(function(){
        if(recordQueues.get(qid)===next)recordQueues.delete(qid);
      });

    recordQueues.set(qid,next);
    return next;
  }

  function diffAndQueue(cacheKey,beforeRaw,afterRaw){
    const module=cacheToModule[cacheKey];
    if(!module || window.__NCT_OPERATIONAL_APPLYING)return;

    const before=toMap(module,beforeRaw);
    const after=toMap(module,afterRaw);

    after.forEach(function(payload,key){
      const old=before.get(key);
      if(!old || !deepEqual(old,payload)){
        queueOperation({
          action:'save',
          module:module,
          recordKey:key,
          payload:payload,
          queuedAt:new Date().toISOString()
        });
      }
    });

    before.forEach(function(_,key){
      if(!after.has(key)){
        queueOperation({
          action:'delete',
          module:module,
          recordKey:key,
          payload:null,
          queuedAt:new Date().toISOString()
        });
      }
    });
  }

  function installStorageBridge(){
    if(Storage.prototype.setItem.__nctMultiEditorSafe)return;

    function patchedSetItem(key,value){
      const isLocal=this===window.localStorage;
      const k=String(key);
      const tracked=isLocal && Object.prototype.hasOwnProperty.call(cacheToModule,k);
      const before=tracked?nativeGet(k):null;
      const result=nativeSet.call(this,key,value);

      if(tracked && !window.__NCT_OPERATIONAL_APPLYING){
        setTimeout(()=>diffAndQueue(k,before,String(value)),0);
      }
      return result;
    }

    function patchedRemoveItem(key){
      const isLocal=this===window.localStorage;
      const k=String(key);
      const tracked=isLocal && Object.prototype.hasOwnProperty.call(cacheToModule,k);
      const before=tracked?nativeGet(k):null;
      const result=nativeRemove.call(this,key);

      if(tracked && !window.__NCT_OPERATIONAL_APPLYING){
        setTimeout(()=>diffAndQueue(k,before,cacheToModule[k]==='initial_stock'?'{}':'[]'),0);
      }
      return result;
    }

    function nativeGet(key){
      return Storage.prototype.getItem.call(window.localStorage,key);
    }

    patchedSetItem.__nctMultiEditorSafe=true;
    Storage.prototype.setItem=patchedSetItem;
    Storage.prototype.removeItem=patchedRemoveItem;
  }

  async function retryPending(){
    if(!window.NCTSupabase)return;
    const list=loadPending();
    if(!list.length)return;

    for(const op of list){
      const qid=pendingId(op.module,op.recordKey);
      if(recordQueues.has(qid))continue;
      queueOperation(op);
    }
  }

  function hasPendingForModule(module){
    if((modulePending.get(module)||0)>0)return true;
    return loadPending().some(op=>op.module===module);
  }

  function startRealtime(context){
    if(!window.NCTSupabase?.subscribeOperationalChanges)return;

    const myId=String(context?.user?.id||'');

    unsubscribeRealtime=window.NCTSupabase.subscribeOperationalChanges(async function(change){
      const row=change?.new && Object.keys(change.new).length ? change.new : change?.old;
      const module=String(row?.module||'');
      if(!module)return;

      // Event dari save kita sendiri tidak perlu memicu refresh.
      if(change?.new?.updated_by && String(change.new.updated_by)===myId)return;

      // Jika module sedang punya pending local write, jangan auto-merge.
      // OCC akan menjaga agar save stale tidak menimpa server.
      if(hasPendingForModule(module)){
        setSyncBadge('saving','UPDATE BARU');
        return;
      }

      await refreshModule(module,true);
      setSyncBadge('saved','TERSINKRON');
    });
  }

  function installManualRefreshListener(){
    document.addEventListener('nct-operational-refreshed',function(){
      Object.keys(cacheToModule).forEach(function(k){
        updateRuntimeFromCaches(cacheToModule[k]);
      });
      setSyncBadge('saved','TERSINKRON');
    });
  }

  async function start(context){
    if(started)return;
    started=true;

    if(!window.NCTSupabase){
      console.error('NCTSupabase belum tersedia.');
      return;
    }

    installStorageBridge();
    installManualRefreshListener();
    startRealtime(context);

    window.addEventListener('online',retryPending);
    retryTimer=setInterval(retryPending,15000);
    retryPending();

    window.addEventListener('pagehide',function(){
      try{unsubscribeRealtime&&unsubscribeRealtime()}catch(_){}
      if(retryTimer)clearInterval(retryTimer);
    },{once:true});

    window.NCTMultiEditor={
      refreshModule:refreshModule,
      retryPending:retryPending,
      pending:function(){return loadPending()},
      conflicts:function(){return safeJson(localStorage.getItem(CONFLICT_KEY),[])||[]}
    };

    setSyncBadge('saved','TERSINKRON');
  }

  if(window.NCT_USER_CONTEXT)start(window.NCT_USER_CONTEXT);
  else document.addEventListener('nct-auth-ready',function(e){start(e.detail);},{once:true});
})();
