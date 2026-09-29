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
  const bulkLocks=new Map();
  let started=false;
  let unsubscribeRealtime=null;
  let retryTimer=null;
  let alertCooldown=0;

  // V45 PERFORMANCE: module besar hanya diambil/render saat page membutuhkannya.
  const loadedModules=new Set();
  const staleModules=new Set();
  const moduleLoads=new Map();
  const pageLoads=new Map();
  let lazyContext=null;

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

  // V57: versi lama pernah memasukkan ratusan baris Ambri otomatis (source=DATABASE 2026)
  // ke antrean ntm_waste. Padahal baris tersebut sepenuhnya turunan dari module production
  // dan akan dibuat ulang saat render. Buang hanya pending otomatis ini; input/edit manual tetap aman.
  function cleanDerivedNtmWastePending(){
    const list=loadPending();
    if(!list.length)return 0;
    let dropped=0;
    const keep=list.filter(function(op){
      const source=String(op?.payload?.source||'').trim().toUpperCase();
      const autoDerived=String(op?.module||'')==='ntm_waste'
        && String(op?.action||'')==='save'
        && source==='DATABASE 2026';
      if(autoDerived)dropped++;
      return !autoDerived;
    });
    if(dropped)savePending(keep);
    return dropped;
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

  function activePageId(){
    return document.querySelector('.page.active')?.id || 'dashboard';
  }

  function pageOperationalModules(pageId){
    const map={
      dashboard:['production','initial_stock'],
      dashboardContong:[],
      stock:['production','initial_stock'],
      input:['production','initial_stock'],
      packaging:[],
      wastePage:['production','initial_stock','ntm_waste'],
      qualityIncoming:['quality_incoming'],
      qualityGiling:['quality_giling'],
      qualityPackaging:[],
      database:['production','initial_stock','quality_giling'],
      backupData:['production','initial_stock','ntm_waste','quality_incoming','quality_giling'],
      settings:[]
    };
    return map[String(pageId||'')]||[];
  }

  function renderActivePage(pageId){
    const id=String(pageId||activePageId());
    try{
      if(id==='dashboard'){
        if(typeof fillFilters==='function')fillFilters();
        if(typeof updateDashboard==='function')updateDashboard();
      }else if(id==='dashboardContong'){
        window.NCTContongDashboard?.onOpen?.();
      }else if(id==='stock'){
        if(typeof renderStock==='function')renderStock();
        if(typeof renderStockCards==='function')renderStockCards();
        if(typeof renderTobaccoTable==='function')renderTobaccoTable();
      }else if(id==='input'){
        if(typeof renderInputHistory==='function')renderInputHistory();
      }else if(id==='packaging'){
        window.renderPackagingStockCards?.();
        window.renderPackagingProdKpis?.();
        window.renderPackagingHistory?.();
      }else if(id==='wastePage'){
        if(typeof recalcStocks==='function')recalcStocks();
        if(typeof updateWastePeriodUI==='function')updateWastePeriodUI();
        if(typeof syncAmbriNtmFromDatabase==='function')syncAmbriNtmFromDatabase();
        if(typeof renderWastePage==='function')renderWastePage();
        if(typeof renderNtmWastePage==='function')renderNtmWastePage();
        if(typeof renderUnifiedWasteHistory==='function')renderUnifiedWasteHistory();
      }else if(id==='qualityIncoming'){
        if(typeof renderQualityIncomingPage==='function')renderQualityIncomingPage();
      }else if(id==='qualityGiling'){
        // V59: renderer Quality berada dalam IIFE; panggil hook global resmi.
        // Ini memastikan pindah menu / login ulang tidak memakai qggProgressCache kosong.
        try{window.NCTQualityGilingRuntime?.refresh?.();}catch(err){
          console.warn('[NCT V59] Quality page refresh warning:',err);
        }
      }else if(id==='database'){
        if(typeof renderTable==='function')renderTable();
        window.updateDatabaseUploadHubCounts?.();
        window.refreshDatabaseServerCountsV65?.();
      }else if(id==='backupData'){
        window.NCTBackupData?.onOpen?.();
      }else if(id==='settings'){
        try{if(typeof renderMasterBrands==='function')renderMasterBrands()}catch(_){ }
        try{if(typeof renderMasterUsers==='function')renderMasterUsers()}catch(_){ }
      }
    }catch(err){
      console.warn('Lazy page render warning:',id,err);
    }
  }

  function updateRuntimeFromCaches(module){
    try{
      if(module==='production' && typeof data!=='undefined'){
        const arr=safeJson(localStorage.getItem('giling_dashboard_2026_v4_clean'),[]);
        if(Array.isArray(arr))data.splice(0,data.length,...arr);
      }

      if(module==='initial_stock' && typeof initialStocks!=='undefined'){
        const obj=safeJson(localStorage.getItem('giling_initial_stocks_v2'),{});
        initialStocks=obj&&typeof obj==='object'?obj:{};
      }

      if(module==='ntm_waste' && typeof ntmWasteData!=='undefined'){
        const arr=safeJson(localStorage.getItem('ntm_waste_2026_v2'),[]);
        if(Array.isArray(arr))ntmWasteData.splice(0,ntmWasteData.length,...arr);
      }

      if(module==='quality_giling'){
        // V59: seluruh renderer Quality hidup di scope IIFE sendiri. Variabel/cache
        // internal tidak dapat di-reset dari bridge lazy-loader ini secara langsung.
        // Gunakan hook runtime resmi agar cache lama (misalnya [] sebelum hydrate)
        // dibuang lalu seluruh KPI/filter/chart langsung membaca local cache hasil Supabase.
        try{window.NCTQualityGilingRuntime?.refresh?.();}catch(err){
          console.warn('[NCT V59] Quality runtime refresh warning:',err);
        }
      }

      // V45: jangan render halaman tersembunyi. Cukup mutakhirkan RAM; renderer
      // aktif dijalankan sekali setelah semua module page tersebut selesai load.
    }catch(err){
      console.warn('Runtime refresh warning:',module,err);
    }
  }

  async function refreshModule(module,quiet){
    try{
      await window.NCTSupabase.refreshOperationalModule(module);
      applyPendingOverlay(module);
      loadedModules.add(String(module));
      staleModules.delete(String(module));
      updateRuntimeFromCaches(module);
      if(pageOperationalModules(activePageId()).includes(String(module)))renderActivePage(activePageId());
      if(!quiet)showNotice('Data '+module+' sudah disinkronkan dengan Supabase.','ok');
      return true;
    }catch(err){
      console.error('Refresh module error:',err);
      if(!quiet)showNotice('Gagal mengambil data terbaru. Periksa koneksi internet.','error');
      return false;
    }
  }

  async function ensureModules(modules,options){
    options=options||{};
    const wanted=[...new Set((Array.isArray(modules)?modules:[]).map(String))]
      .filter(module=>Object.values(cacheToModule).includes(module));
    const jobs=wanted.map(function(module){
      if(loadedModules.has(module) && !staleModules.has(module))return Promise.resolve(true);
      if(moduleLoads.has(module))return moduleLoads.get(module);
      const job=(async function(){
        try{
          let state=null;
          if(typeof window.NCTSupabase?.prepareOperationalModules==='function'){
            state=await window.NCTSupabase.prepareOperationalModules([module],lazyContext||window.NCT_USER_CONTEXT);
          }else{
            await window.NCTSupabase.refreshOperationalModule(module);
            state={[module]:true};
          }
          applyPendingOverlay(module);
          loadedModules.add(module);
          staleModules.delete(module);
          updateRuntimeFromCaches(module);
          return state;
        }finally{
          moduleLoads.delete(module);
        }
      })();
      moduleLoads.set(module,job);
      return job;
    });
    await Promise.all(jobs);
    return true;
  }

  async function ensurePage(pageId,options){
    const id=String(pageId||'dashboard');
    if(pageLoads.has(id))return pageLoads.get(id);
    const job=(async function(){
      setSyncBadge('saving','MEMUAT '+id.toUpperCase());
      try{
        // Operational + dashboard_state store untuk page ini dimuat paralel.
        await Promise.all([
          ensureModules(pageOperationalModules(id),options),
          window.NCTExtraSupabaseState?.ensurePage?.(id,{seedMissing:true}) || Promise.resolve(true)
        ]);
        // Render satu kali sesudah semua sumber page aktif sudah siap.
        if(activePageId()===id)renderActivePage(id);
        setSyncBadge('saved','TERSINKRON');
        return true;
      }catch(err){
        console.error('Lazy page load error:',id,err);
        setSyncBadge('error','SYNC ERROR');
        if(!options?.quiet)showNotice('Data '+id+' belum selesai dimuat dari Supabase.','error');
        return false;
      }finally{
        pageLoads.delete(id);
      }
    })();
    pageLoads.set(id,job);
    return job;
  }

  document.addEventListener('nct-operational-module-updated',function(e){
    const module=String(e?.detail?.module||'');
    if(!module)return;
    loadedModules.add(module);
    staleModules.delete(module);
    updateRuntimeFromCaches(module);
    try{window.updateDatabaseUploadHubCounts?.();}catch(_){ }
    if(pageOperationalModules(activePageId()).includes(module))renderActivePage(activePageId());
  });

  function installLazyPageHook(){
    const original=window.showPage;
    if(typeof original!=='function' || original.__nctLazyV45)return;
    const wrapped=function(id){
      const result=original.apply(this,arguments);
      // Navigasi/layout terjadi langsung; data berat menyusul tanpa memblok klik.
      Promise.resolve().then(()=>ensurePage(id,{quiet:true}));
      return result;
    };
    wrapped.__nctLazyV45=true;
    window.showPage=wrapped;
  }

  function mergeConflictPayload(basePayload,localPayload,remotePayload){
    const local=(localPayload&&typeof localPayload==='object'&&!Array.isArray(localPayload))?cleanPayload(localPayload):{};
    const remote=(remotePayload&&typeof remotePayload==='object'&&!Array.isArray(remotePayload))?cleanPayload(remotePayload):{};
    const hasBase=!!(basePayload&&typeof basePayload==='object'&&!Array.isArray(basePayload));

    // Pending dari versi lama belum memiliki basePayload. Dalam kasus itu jangan
    // membuang field server yang tidak dikenal: overlay payload lokal di atas server.
    if(!hasBase)return {...remote,...local};

    const base=cleanPayload(basePayload)||{};
    const merged={...remote};
    const keys=new Set([...Object.keys(base),...Object.keys(local)]);
    keys.forEach(function(key){
      if(deepEqual(base[key],local[key]))return;
      if(Object.prototype.hasOwnProperty.call(local,key))merged[key]=local[key];
      else delete merged[key];
    });
    return merged;
  }

  async function handleConflict(op){
    // V56: konflik versi normal tidak lagi membuang perubahan user. Ambil versi
    // server terbaru, gabungkan hanya field yang memang berubah secara lokal,
    // lalu retry dengan version terbaru. Ini juga menyelesaikan false-conflict
    // akibat dua tab/browser yang menyimpan record sama berdekatan waktunya.
    setSyncBadge('saving','MENYATUKAN');

    let remote=null;
    let lastErr=null;
    for(let attempt=1;attempt<=4;attempt++){
      try{
        remote=await window.NCTSupabase.fetchOperationalRecord(op.module,op.recordKey);

        if(op.action==='delete'){
          if(remote){
            await window.NCTSupabase.deleteOperationalRecord(
              op.module,op.recordKey,Number(remote.version||0)
            );
          }
        }else{
          const merged=mergeConflictPayload(op.basePayload,op.payload,remote?.payload);
          await window.NCTSupabase.saveOperationalRecord(
            op.module,op.recordKey,merged,Number(remote?.version||0)
          );
        }

        removePending(op.module,op.recordKey);
        await refreshModule(op.module,true);
        setSyncBadge('saved','TERSIMPAN');
        showNotice('Perubahan dari perangkat lain terdeteksi. Data sudah digabung dan tersimpan.','ok');
        return true;
      }catch(err){
        lastErr=err;
        if(err?.code!=='NCT_CONFLICT')break;
        await new Promise(r=>setTimeout(r,80*attempt));
      }
    }

    // Jangan buang perubahan lokal jika retry gagal. Simpan sebagai pending agar
    // dapat dicoba lagi otomatis atau saat user menekan sinkronisasi.
    try{storeConflict(op,remote)}catch(_){}
    setSyncBadge('error','PENDING');
    showNotice(
      'Perubahan terjadi bersamaan. Data Anda masih disimpan sementara dan akan dicoba lagi otomatis.',
      'error'
    );
    try{
      document.dispatchEvent(new CustomEvent('nct-operational-conflict',{
        detail:{operation:op,remote:remote,error:lastErr||null}
      }));
    }catch(_){}
    return false;
  }

  function queueOperation(op){
    const qid=pendingId(op.module,op.recordKey);

    // V67: bulk database import dan edit manual adalah dua jalur TERPISAH.
    // Selama bulk lock aktif, perubahan cache yang berasal dari import/recalc
    // tidak boleh masuk pending queue sama sekali. Ini mencegah 1 upload Excel
    // berubah menjadi ratusan operasi per-record dan status MENYATUKAN/MENYIMPAN.
    if(bulkLocks.has(op.module)){
      setSyncBadge('saving','UPLOAD DATABASE');
      return Promise.resolve({queued:false,bulkLocked:true,ignoredDuringBulk:true});
    }

    upsertPending(op);

    const previous=recordQueues.get(qid)||Promise.resolve();

    const next=previous
      .catch(()=>{})
      .then(async function(){
        // V66: lock dicek LAGI tepat sebelum request dikirim. Operasi yang sudah
        // masuk antrean sebelum bulk lock aktif tidak boleh lolos dan berlomba
        // dengan transaksi replace database.
        if(bulkLocks.has(op.module)){
          setSyncBadge('saving','UPLOAD DATABASE');
          return {queued:true,bulkLocked:true};
        }
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
    if(!module || window.__NCT_OPERATIONAL_APPLYING || bulkLocks.has(module))return;

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
          basePayload:old?cleanPayload(old):null,
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
          basePayload:cleanPayload(before.get(key)),
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

      const trackedModule=tracked?cacheToModule[k]:'';
      if(tracked && !window.__NCT_OPERATIONAL_APPLYING && !bulkLocks.has(trackedModule)){
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

      const trackedModule=tracked?cacheToModule[k]:'';
      if(tracked && !window.__NCT_OPERATIONAL_APPLYING && !bulkLocks.has(trackedModule)){
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
    cleanDerivedNtmWastePending();
    const list=loadPending();
    if(!list.length)return;

    for(const op of list){
      if(bulkLocks.has(op.module))continue;
      const qid=pendingId(op.module,op.recordKey);
      if(recordQueues.has(qid))continue;
      queueOperation(op);
    }
  }

  function hasPendingForModule(module){
    if((modulePending.get(module)||0)>0)return true;
    return loadPending().some(op=>op.module===module);
  }


  // Pending write disimpan di localStorage kecil (bukan database besar). Saat page
  // direfresh sebelum Supabase selesai menerima write, overlay ini menampilkan
  // kembali perubahan pending di atas snapshot server sehingga input user tidak
  // tampak hilang. Begitu RPC sukses, pending dihapus dan server tetap source of truth.
  function applyPendingOverlay(module){
    module=String(module||'');
    const pending=loadPending().filter(op=>String(op?.module||'')===module);
    if(!pending.length)return false;

    const cacheKey=Object.keys(cacheToModule).find(k=>cacheToModule[k]===module);
    if(!cacheKey)return false;

    let next;
    if(module==='initial_stock'){
      const obj=safeJson(localStorage.getItem(cacheKey),{});
      next=(obj && typeof obj==='object' && !Array.isArray(obj))?{...obj}:{};
      pending.forEach(function(op){
        const brand=String(op?.payload?.brand||op?.recordKey||'').trim();
        if(!brand)return;
        if(op.action==='delete')delete next[brand];
        else next[brand]=op?.payload?.value;
      });
    }else{
      const arr=safeJson(localStorage.getItem(cacheKey),[]);
      const map=new Map();
      (Array.isArray(arr)?arr:[]).forEach(function(row){
        const key=rowKey(module,row);
        if(key)map.set(String(key),cleanPayload(row));
      });
      pending.forEach(function(op){
        const key=String(op?.recordKey||'');
        if(!key)return;
        if(op.action==='delete')map.delete(key);
        else map.set(key,cleanPayload(op?.payload||{}));
      });
      next=[...map.values()];
    }

    window.__NCT_OPERATIONAL_APPLYING=(window.__NCT_OPERATIONAL_APPLYING||0)+1;
    try{nativeSet.call(localStorage,cacheKey,JSON.stringify(next))}
    finally{window.__NCT_OPERATIONAL_APPLYING=Math.max(0,(window.__NCT_OPERATIONAL_APPLYING||1)-1)}
    return true;
  }

  // Dipakai form untuk memastikan label "tersimpan" hanya diberikan sesudah
  // write benar-benar diterima Supabase. Bila masih pending, caller mendapat error.
  async function flushModule(module,timeoutMs){
    module=String(module||'');
    if(module==='ntm_waste')cleanDerivedNtmWastePending();
    timeoutMs=Math.max(1500,Number(timeoutMs)||10000);
    await new Promise(r=>setTimeout(r,0)); // beri diffAndQueue kesempatan masuk queue
    await retryPending();

    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      const pending=loadPending().filter(op=>String(op?.module||'')===module);
      if(!pending.length && (modulePending.get(module)||0)===0)return true;
      await new Promise(r=>setTimeout(r,120));
    }

    const left=loadPending().filter(op=>String(op?.module||'')===module).length;
    const err=new Error(left
      ? ('Masih ada '+left+' perubahan '+module+' yang belum tersimpan ke Supabase.')
      : ('Sinkronisasi '+module+' belum selesai.'));
    err.code='NCT_SYNC_PENDING';
    err.pendingCount=left;
    throw err;
  }

  async function cleanBulkUploadPending(module,sourceTag){
    module=String(module||'');
    sourceTag=String(sourceTag||'').toUpperCase();
    const list=loadPending();
    if(!list.length)return {dropped:0,preserved:0};

    const keep=[];
    let dropped=0,preserved=0;
    for(const op of list){
      if(op?.module!==module){keep.push(op);continue;}

      let isOldUpload=false;
      if(op.action==='save'){
        isOldUpload=String(op?.payload?.databaseUploadSource||'').toUpperCase()===sourceTag;
      }else if(op.action==='delete'){
        try{
          const remote=await window.NCTSupabase.fetchOperationalRecord(module,op.recordKey);
          if(!remote){isOldUpload=true;}
          else isOldUpload=String(remote?.payload?.databaseUploadSource||'').toUpperCase()===sourceTag;
        }catch(_){ }
      }

      if(isOldUpload)dropped++;
      else{keep.push(op);preserved++;}
    }
    savePending(keep);
    return {dropped,preserved};
  }

  async function prepareBulkReplace(module,sourceTag){
    module=String(module||'');
    sourceTag=String(sourceTag||'').toUpperCase();
    bulkLocks.set(module,sourceTag||'BULK');
    setSyncBadge('saving','UPLOAD DATABASE');

    // V66: bulk replace TIDAK BOLEH dimulai selama write per-record lama masih
    // aktif. Lebih baik batalkan upload daripada membuat dataset server setengah.
    const startedAt=Date.now();
    while((modulePending.get(module)||0)>0 && Date.now()-startedAt<30000){
      await new Promise(r=>setTimeout(r,100));
    }
    if((modulePending.get(module)||0)>0){
      bulkLocks.delete(module);
      const err=new Error('Masih ada sinkronisasi lama yang aktif. Tutup tab dashboard lain, tunggu beberapa detik, lalu upload ulang.');
      err.code='NCT_BULK_BUSY';
      throw err;
    }

    const cleaned=await cleanBulkUploadPending(module,sourceTag);
    return {module,sourceTag,...cleaned};
  }

  async function endBulkReplace(module,sourceTag){
    module=String(module||'');
    sourceTag=String(sourceTag||'').toUpperCase();
    try{
      // A stale timer may have queued an old upload op while the module was
      // locked. Remove those once more before normal retry resumes.
      await cleanBulkUploadPending(module,sourceTag);
    }finally{
      bulkLocks.delete(module);
      setSyncBadge('saved','TERSINKRON');
      setTimeout(retryPending,0);
    }
    return true;
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

      // Jika module belum pernah dibuka, cukup tandai stale. Jangan download +
      // render page tersembunyi hanya karena ada event realtime.
      if(!loadedModules.has(module)){
        staleModules.add(module);
        return;
      }

      // Jika module sedang punya pending local write, jangan auto-merge.
      // OCC akan menjaga agar save stale tidak menimpa server.
      if(hasPendingForModule(module)){
        staleModules.add(module);
        setSyncBadge('saving','UPDATE BARU');
        return;
      }

      await refreshModule(module,true);
      setSyncBadge('saved','TERSINKRON');
    });
  }

  function installManualRefreshListener(){
    document.addEventListener('nct-operational-refreshed',function(e){
      const detail=e?.detail&&typeof e.detail==='object'?e.detail:{};
      const modules=Object.keys(detail).filter(m=>Object.values(cacheToModule).includes(m));
      const targets=modules.length?modules:[...loadedModules];
      targets.forEach(function(module){
        loadedModules.add(module);
        staleModules.delete(module);
        updateRuntimeFromCaches(module);
      });
      renderActivePage(activePageId());
      setSyncBadge('saved','TERSINKRON');
    });
  }

  function cleanLegacyBulkStormV66(){
    // Satu kali recovery dari V64/V65: versi lama sempat membuat ratusan pending
    // per-record saat upload Excel. Hanya bersihkan bila pola benar-benar bulk
    // (>=25 operasi) dan source-nya database upload yang dikenal.
    const flag='nct_v66_bulk_storm_cleanup_done';
    try{if(localStorage.getItem(flag)==='1')return 0}catch(_){ }
    const list=loadPending();
    const bulkSources=new Set(['GILING_GUNTING','QUALITY_GILING_GUNTING']);
    const matching=list.filter(function(op){
      if(!['production','quality_giling'].includes(String(op?.module||'')))return false;
      const source=String(
        op?.action==='delete'
          ? (op?.basePayload?.databaseUploadSource||'')
          : (op?.payload?.databaseUploadSource||'')
      ).toUpperCase();
      return bulkSources.has(source);
    });
    if(matching.length<25){
      try{localStorage.setItem(flag,'1')}catch(_){ }
      return 0;
    }
    const ids=new Set(matching.map(op=>pendingId(op.module,op.recordKey)));
    const keep=list.filter(op=>!ids.has(pendingId(op.module,op.recordKey)));
    savePending(keep);
    try{localStorage.setItem(flag,'1')}catch(_){ }
    console.warn('[NCT V67] legacy bulk pending storm dibersihkan:',matching.length);
    return matching.length;
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
    const removedDerivedPending=cleanDerivedNtmWastePending();
    if(removedDerivedPending)console.info('[NCT V57] pending Ambri otomatis dibersihkan:',removedDerivedPending);
    const removedBulkStorm=cleanLegacyBulkStormV66();
    if(removedBulkStorm)console.info('[NCT V67] antrean bulk lama tidak akan dikirim ulang per-record.');
    console.info('[NCT V67] sync aktif: bulk database memakai staging atomik; write per-record tidak boleh berlomba dengan upload database.');
    retryPending();

    window.addEventListener('pagehide',function(){
      try{unsubscribeRealtime&&unsubscribeRealtime()}catch(_){}
      if(retryTimer)clearInterval(retryTimer);
    },{once:true});

    window.NCTMultiEditor={
      refreshModule:refreshModule,
      retryPending:retryPending,
      flushModule:flushModule,
      applyPendingOverlay:applyPendingOverlay,
      pending:function(){cleanDerivedNtmWastePending();return loadPending()},
      conflicts:function(){return safeJson(localStorage.getItem(CONFLICT_KEY),[])||[]},
      prepareBulkReplace:prepareBulkReplace,
      endBulkReplace:endBulkReplace,
      ensurePage:ensurePage,
      ensureModules:ensureModules,
      loadedModules:function(){return [...loadedModules]},
      isLoaded:function(module){return loadedModules.has(String(module))},
      queueDiff:function(cacheKey,beforeRaw,afterRaw){
        diffAndQueue(String(cacheKey||''),String(beforeRaw??''),String(afterRaw??''));
        return true;
      }
    };

    // V45: jangan hydrate seluruh sistem saat login. Shell/UI boleh selesai paint
    // dahulu; hanya page aktif yang mengambil module Supabase yang diperlukan.
    lazyContext=context;
    installLazyPageHook();
    setSyncBadge('saving','MEMUAT DASHBOARD');

    const boot=function(){
      installLazyPageHook();
      ensurePage(activePageId()||'dashboard',{quiet:true}).catch(function(err){
        console.error('Initial lazy hydration error:',err);
        setSyncBadge('error','SYNC ERROR');
      });
    };

    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',function(){
        // Dua frame memberi browser kesempatan menyelesaikan layout/header/sidebar.
        requestAnimationFrame(()=>requestAnimationFrame(boot));
      },{once:true});
    }else{
      requestAnimationFrame(()=>requestAnimationFrame(boot));
    }
  }

  if(window.NCT_USER_CONTEXT)start(window.NCT_USER_CONTEXT);
  else document.addEventListener('nct-auth-ready',function(e){start(e.detail);},{once:true});
})();
