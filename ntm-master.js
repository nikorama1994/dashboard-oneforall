(function(){
  'use strict';

  const DEFAULTS=[
    {code:'ambri',name:'Ambri',unit:'Pcs',color:'#62c8ff',sort_order:10,is_system:true,from_database:true,is_active:true},
    {code:'etiket',name:'Etiket',unit:'Lembar',color:'#a78bfa',sort_order:20,is_system:false,from_database:false,is_active:true},
    {code:'opp',name:'OPP',unit:'Lembar',color:'#4dd8c8',sort_order:30,is_system:false,from_database:false,is_active:true},
    {code:'mop',name:'MOP',unit:'Lembar',color:'#f0a55a',sort_order:40,is_system:false,from_database:false,is_active:true},
    {code:'sticker',name:'Sticker',unit:'Keping',color:'#f47faa',sort_order:50,is_system:false,from_database:false,is_active:true}
  ];

  const PALETTE=[
    '#62c8ff','#a78bfa','#4dd8c8','#f0a55a','#f47faa',
    '#f7d064','#78e09d','#e68df1','#64a6ff','#ff8d7d',
    '#7ed8ec','#b6dd65'
  ];

  let master=[];
  let editingCode=null;
  let realtimeChannel=null;

  const $=id=>document.getElementById(id);

  function esc(v){
    return String(v??'').replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function slugify(v){
    return String(v||'')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,40);
  }

  function normalizeUnit(v){
    return String(v||'').trim()||'Pcs';
  }

  function hexToRgb(hex){
    const x=String(hex||'#62c8ff').replace('#','');
    const h=x.length===3?x.split('').map(c=>c+c).join(''):x;
    const n=parseInt(h,16);
    if(!Number.isFinite(n))return '98,200,255';
    return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
  }

  function colorForIndex(i){
    return PALETTE[i%PALETTE.length];
  }

  function activeTypes(){
    return master
      .filter(x=>x.is_active!==false)
      .sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.name).localeCompare(String(b.name),'id'));
  }

  function getType(code){
    return master.find(x=>x.code===code) || DEFAULTS.find(x=>x.code===code) || null;
  }

  function cfgFromMaster(item){
    const unit=normalizeUnit(item.unit);
    const upper=String(item.name||item.code).toUpperCase();
    return {
      name:String(item.name||item.code),
      actualLabel:item.code==='ambri'?'PRODUKSI AMBRI (PCS)':`PRODUKSI (${unit.toUpperCase()})`,
      useLabel:item.code==='ambri'?'PEMAKAIAN AMBRI (PCS)':`PEMAKAIAN ${upper} (${unit.toUpperCase()})`,
      wasteLabel:item.code==='ambri'?'WASTE AMBRI (PCS)':`WASTE ${upper} (${unit.toUpperCase()})`,
      actualUnit:unit,
      useUnit:unit,
      wasteUnit:unit,
      unit:unit,
      fromDatabase:!!item.from_database,
      color:item.color||'#62c8ff'
    };
  }

  function syncNtmTypesObject(){
    try{
      if(typeof NTM_TYPES==='undefined')return;

      Object.keys(NTM_TYPES).forEach(k=>delete NTM_TYPES[k]);
      activeTypes().forEach(item=>{
        NTM_TYPES[item.code]=cfgFromMaster(item);
      });

      // AMBRI is a protected system type; keep fallback even if backend is temporarily unavailable.
      if(!NTM_TYPES.ambri){
        const ambri=DEFAULTS[0];
        NTM_TYPES.ambri=cfgFromMaster(ambri);
      }
    }catch(err){
      console.warn('Gagal sinkron NTM_TYPES:',err);
    }
  }

  function currentRole(){
    let role=String(window.NCT_USER_CONTEXT?.profile?.role||'guest_internal').toLowerCase();
    if(role==='viewer')role='guest_internal';
    return role;
  }

  function client(){
    return window.NCTSupabase?.client || null;
  }

  async function fetchMaster(){
    const sb=client();
    if(!sb){
      master=DEFAULTS.map(x=>({...x}));
      return master;
    }

    try{
      const {data,error}=await sb
        .from('master_ntm_types')
        .select('code,name,unit,color,sort_order,is_system,from_database,is_active,created_at,updated_at')
        .order('sort_order',{ascending:true})
        .order('name',{ascending:true});

      if(error)throw error;
      master=Array.isArray(data)&&data.length?data:DEFAULTS.map(x=>({...x}));
    }catch(err){
      console.warn('Master NTM Supabase belum tersedia, memakai default:',err);
      master=DEFAULTS.map(x=>({...x}));
    }
    return master;
  }

  function buildInputTypeOptions(){
    const el=$('nType');
    if(!el)return;
    const list=activeTypes();
    const current=el.value;
    el.innerHTML=list.map(x=>`<option value="${esc(x.code)}">${esc(String(x.name).toUpperCase())}</option>`).join('');
    if(list.some(x=>x.code===current))el.value=current;
    else if(list.some(x=>x.code==='ambri'))el.value='ambri';
    else if(list[0])el.value=list[0].code;
    try{ if(typeof updateNtmWasteTypeUI==='function')updateNtmWasteTypeUI(); }catch(_){}
  }

  function ntmUsageCount(code){
    try{
      if(typeof ntmWasteData!=='undefined' && Array.isArray(ntmWasteData)){
        return ntmWasteData.filter(r=>(r.type||'ambri')===code).length;
      }
    }catch(_){}
    return 0;
  }

  function renderDynamicCards(){
    const grid=document.querySelector('.wasteNtmCard .ntmSummaryGrid');
    if(!grid)return;

    const list=activeTypes();
    grid.innerHTML=list.map(item=>{
      const cfg=cfgFromMaster(item);
      const rgb=hexToRgb(item.color);
      return `<div class="ntmMaterialCard" data-dynamic-ntm="1" data-ntm="${esc(item.code)}" style="--ntm-accent:${esc(item.color)};--ntm-accent-rgb:${rgb}">
        <div class="ntmMaterialTitle">${esc(String(item.name).toUpperCase())}</div>
        <div class="ntmMetricRow"><span>Total Produksi</span><b data-ntm-metric="${esc(item.code)}:production">0 ${esc(cfg.unit)}</b></div>
        <div class="ntmMetricRow"><span>Total Pemakaian</span><b data-ntm-metric="${esc(item.code)}:usage">0 ${esc(cfg.unit)}</b></div>
        <div class="ntmMetricRow"><span>Total Waste</span><b data-ntm-metric="${esc(item.code)}:waste">0 ${esc(cfg.unit)}</b></div>
        <div class="ntmPercentRow">
          <div><span>% Waste</span><b data-ntm-metric="${esc(item.code)}:wastePct">0,00%</b></div>
          <div><span>% Yield</span><b data-ntm-metric="${esc(item.code)}:yieldPct">0,00%</b></div>
        </div>
      </div>`;
    }).join('');
  }

  function computeTotals(){
    const totals={};
    activeTypes().forEach(item=>{
      totals[item.code]={production:0,usage:0,waste:0,unit:normalizeUnit(item.unit)};
    });

    // AMBRI remains sourced from DATABASE 2026.
    if(totals.ambri && typeof getNtmDatabaseAmbriRows==='function'){
      const byKey=new Map();
      getNtmDatabaseAmbriRows().forEach(r=>{
        const key=`${r.brand}|${dateKey(r.date)}`;
        const usage=num(r.useAmbri);
        const waste=num(r.wasteAmbri);
        byKey.set(key,{production:usage+waste,usage,waste});
      });
      byKey.forEach(v=>{
        totals.ambri.production+=v.production;
        totals.ambri.usage+=v.usage;
        totals.ambri.waste+=v.waste;
      });
    }

    if(typeof getNtmPageRows==='function'){
      getNtmPageRows().forEach(r=>{
        const type=r.type||'ambri';
        if(type==='ambri'||!totals[type])return;
        totals[type].production+=num(r.actual);
        totals[type].usage+=num(r.usage!=null?r.usage:r.useAmbri);
        totals[type].waste+=num(r.waste!=null?r.waste:r.wasteAmbri);
      });
    }
    return totals;
  }

  function renderDynamicNtmPage(){
    try{ if(typeof fillNtmPageBrands==='function')fillNtmPageBrands(); }catch(_){}
    try{ if(typeof fillNtmWeekOptions==='function')fillNtmWeekOptions(); }catch(_){}
    try{
      if(($('ntmPeriod')?.value||'all')==='weekly' && typeof syncNtmWeekDates==='function')syncNtmWeekDates();
    }catch(_){}

    renderDynamicCards();
    const totals=computeTotals();

    Object.keys(totals).forEach(code=>{
      const t=totals[code];
      const pct=(a,b)=>b!==0?(a/b)*100:0;
      const set=(metric,val)=>{
        const el=document.querySelector(`[data-ntm-metric="${CSS.escape(code)}:${metric}"]`);
        if(el)el.textContent=val;
      };
      set('production',`${fmt(t.production)} ${t.unit}`);
      set('usage',`${fmt(t.usage)} ${t.unit}`);
      set('waste',`${fmt(t.waste)} ${t.unit}`);
      set('wastePct',`${fmt(pct(t.waste,t.production))}%`);
      set('yieldPct',`${fmt(pct(t.usage,t.production))}%`);
    });
  }

  function renderDynamicHistoryChoices(){
    const bar=$('wasteNtmChoices');
    if(!bar)return;
    const list=activeTypes();

    if(typeof wasteHistoryChoice!=='undefined' && !list.some(x=>x.code===wasteHistoryChoice)){
      wasteHistoryChoice=list.find(x=>x.code==='ambri')?.code || list[0]?.code || 'ambri';
    }

    bar.innerHTML=list.map(item=>{
      const cfg=cfgFromMaster(item);
      const letter=String(item.name||item.code).trim().charAt(0).toUpperCase()||'N';
      const active=typeof wasteHistoryChoice!=='undefined' && wasteHistoryChoice===item.code;
      return `<button class="wasteChoiceBtn${active?' active':''}" data-choice="${esc(item.code)}" onclick="selectWasteHistoryChoice('${esc(item.code)}')" type="button" style="--ntm-choice:${esc(item.color)}">
        <span class="wasteChoiceIcon">${esc(letter)}</span>
        <span><b>${esc(String(item.name).toUpperCase())}</b><small>${esc(cfg.unit)}</small></span>
      </button>`;
    }).join('');
  }

  function dynamicUpdateHistorySelector(){
    const mode=$('wasteHistoryType')?.value||'production';
    if(typeof wasteHistoryMode!=='undefined')wasteHistoryMode=mode;

    if(mode==='production'){
      if(typeof wasteHistoryChoice!=='undefined')wasteHistoryChoice='sapon';
    }else{
      const list=activeTypes();
      if(typeof wasteHistoryChoice!=='undefined' && !list.some(x=>x.code===wasteHistoryChoice)){
        wasteHistoryChoice=list.find(x=>x.code==='ambri')?.code || list[0]?.code || 'ambri';
      }
    }

    const prod=$('wasteProductionChoices');
    const ntm=$('wasteNtmChoices');
    if(prod)prod.style.display=mode==='production'?'flex':'none';
    if(ntm)ntm.style.display=mode==='ntm'?'flex':'none';

    renderDynamicHistoryChoices();

    document.querySelectorAll('.wasteChoiceBtn').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.choice===wasteHistoryChoice);
    });

    try{ if(typeof fillWasteHistoryWeekOptions==='function')fillWasteHistoryWeekOptions(); }catch(_){}
    try{
      if(($('wasteHistoryPeriod')?.value||'all')==='weekly' && typeof syncWasteHistoryWeekDates==='function'){
        syncWasteHistoryWeekDates();
      }
    }catch(_){}
    try{ if(typeof renderUnifiedWasteHistory==='function')renderUnifiedWasteHistory(); }catch(_){}
  }

  function dynamicTrendConfig(){
    const brand=$('ntmFilterBrand')?.value||'';
    const list=activeTypes();
    const maps={};
    list.forEach(x=>maps[x.code]=new Map());
    const allDates=[];

    if(maps.ambri && typeof getNtmDatabaseAmbriRows==='function'){
      getNtmDatabaseAmbriRows().forEach(r=>{
        const d=dateKey(r.date);
        if(!d)return;
        maps.ambri.set(d,(maps.ambri.get(d)||0)+num(r.wasteAmbri));
        allDates.push(d);
      });
    }

    if(typeof getNtmPageRows==='function'){
      getNtmPageRows().forEach(r=>{
        const d=dateKey(r.date),type=r.type||'ambri';
        if(!d||type==='ambri'||!maps[type])return;
        maps[type].set(d,(maps[type].get(d)||0)+num(r.waste!=null?r.waste:r.wasteAmbri));
        allDates.push(d);
      });
    }

    const dates=typeof wasteTrendSelectedDates==='function'
      ? wasteTrendSelectedDates('ntm',allDates)
      : [...new Set(allDates)].sort();

    if(typeof wasteNtmTrendSelection!=='undefined' &&
       wasteNtmTrendSelection!=='all' &&
       !list.some(x=>x.code===wasteNtmTrendSelection)){
      wasteNtmTrendSelection='all';
    }

    const allDatasets=list.map(item=>{
      const cfg=cfgFromMaster(item);
      const color=item.color||'#62c8ff';
      const rgb=hexToRgb(color);
      return {
        key:item.code,
        label:`${String(item.name).toUpperCase()} (${cfg.unit})`,
        __unit:cfg.unit,
        data:dates.map(d=>maps[item.code]?.has(d)&&num(maps[item.code].get(d))!==0?maps[item.code].get(d):null),
        borderColor:color,
        backgroundColor:c=>typeof wasteTrendGradient==='function'
          ? wasteTrendGradient(c,`rgba(${rgb},.18)`,`rgba(${rgb},0)`)
          : `rgba(${rgb},.18)`,
        fill:'origin',
        borderWidth:2.3,
        tension:.32,
        spanGaps:true,
        pointRadius:c=>c.raw==null?0:3,
        pointHoverRadius:c=>c.raw==null?0:6,
        pointBackgroundColor:color,
        pointBorderColor:'#18204f',
        pointBorderWidth:2
      };
    });

    const datasets=(typeof wasteNtmTrendSelection==='undefined'||wasteNtmTrendSelection==='all')
      ? allDatasets
      : allDatasets.filter(ds=>ds.key===wasteNtmTrendSelection);

    const selected=list.find(x=>x.code===wasteNtmTrendSelection);
    const axisUnit=(typeof wasteNtmTrendSelection==='undefined'||wasteNtmTrendSelection==='all')
      ? ''
      : normalizeUnit(selected?.unit);

    return {brand,dates,datasets,axisUnit};
  }

  function dynamicTrendLegend(legendEl){
    if(!legendEl)return;
    const list=activeTypes();
    const selection=typeof wasteNtmTrendSelection!=='undefined'?wasteNtmTrendSelection:'all';
    const items=[
      {code:'all',name:'Semua Material',unit:'',color:'#9ac4ff'},
      ...list.map(x=>({code:x.code,name:x.name,unit:normalizeUnit(x.unit),color:x.color}))
    ];

    legendEl.innerHTML=items.map(item=>`<div class="wasteTrendLegendItem${selection===item.code?' active':''}" data-series="${esc(item.code)}">
      <span class="wasteTrendLegendSwatch" style="background:${esc(item.color)};border-color:${esc(item.color)}"></span>
      <span>${esc(item.name)}${item.unit?` <small>(${esc(item.unit)})</small>`:''}</span>
    </div>`).join('');

    try{ if(typeof bindTrendLegendClicks==='function')bindTrendLegendClicks(legendEl,'ntm'); }catch(_){}
  }

  function overrideRuntimeFunctions(){
    // Mutate the const object used by the original functions.
    syncNtmTypesObject();

    window.renderNtmWastePage=renderDynamicNtmPage;
    window.wasteNtmTrendConfig=dynamicTrendConfig;
    window.renderWasteNtmTrendLegend=dynamicTrendLegend;
    window.updateWasteHistorySelector=dynamicUpdateHistorySelector;
  }

  function refreshAllNtmUI(){
    syncNtmTypesObject();
    buildInputTypeOptions();
    renderDynamicHistoryChoices();
    try{ renderDynamicNtmPage(); }catch(err){console.warn(err)}
    try{ if(typeof renderWasteNtmTrendChart==='function')renderWasteNtmTrendChart(); }catch(err){console.warn(err)}
    try{ if(typeof renderUnifiedWasteHistory==='function')renderUnifiedWasteHistory(); }catch(err){console.warn(err)}
  }

  /* ---------------- MASTER SETTINGS UI ---------------- */

  function injectMasterCard(){
    const grid=document.querySelector('#settings .masterSettingsGrid');
    if(!grid||$('masterNtmCard'))return;

    const brandCard=grid.querySelector('.masterBrandCard');
    const card=document.createElement('section');
    card.className='masterCard masterNtmCard';
    card.id='masterNtmCard';
    card.innerHTML=`
      <div class="masterCardHead">
        <div class="masterCardTitle">
          <span aria-hidden="true" class="masterCardIcon">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M5 5h14v4H5zM5 10h14v4H5zM5 15h14v4H5z" stroke="currentColor" stroke-width="1.7"/>
              <circle cx="8" cy="7" r="1" fill="currentColor"/>
              <circle cx="8" cy="12" r="1" fill="currentColor"/>
              <circle cx="8" cy="17" r="1" fill="currentColor"/>
            </svg>
          </span>
          <div>
            <h3>Master NTM</h3>
            <p>Jenis Waste Non Tobacco Material yang dipakai pada input, card, trend, dan riwayat.</p>
          </div>
        </div>
        <button class="masterAddBtn" id="masterAddNtmBtn" type="button">+ TAMBAH</button>
      </div>
      <div class="masterSearchWrap">
        <input autocomplete="off" id="masterNtmSearch" placeholder="Cari material NTM..." type="search"/>
      </div>
      <div class="masterList" id="masterNtmList"></div>
      <div class="masterListFoot"><span id="masterNtmCount">0 Material</span></div>
    `;

    if(brandCard?.nextSibling)grid.insertBefore(card,brandCard.nextSibling);
    else grid.appendChild(card);

    card.querySelector('#masterAddNtmBtn')?.addEventListener('click',()=>openModal());
    card.querySelector('#masterNtmSearch')?.addEventListener('input',renderMasterList);
  }

  function injectModal(){
    if($('masterNtmModal'))return;

    const modal=document.createElement('div');
    modal.className='masterModal';
    modal.id='masterNtmModal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`
      <div class="masterModalBackdrop" data-ntm-master-close="1"></div>
      <div class="masterModalDialog small" role="dialog" aria-modal="true" aria-labelledby="masterNtmModalTitle">
        <div class="masterModalHead">
          <div>
            <div class="masterSettingsEyebrow">MASTER NTM</div>
            <h3 id="masterNtmModalTitle">Tambah Material NTM</h3>
          </div>
          <button class="masterModalClose" data-ntm-master-close="1" type="button">×</button>
        </div>
        <form id="masterNtmForm">
          <div class="masterModalBody">
            <div class="masterNtmFormGrid">
              <div class="masterField">
                <label for="masterNtmName">NAMA MATERIAL</label>
                <input id="masterNtmName" maxlength="50" placeholder="Contoh: Foil" required type="text"/>
                <div class="masterNtmCodePreview" id="masterNtmCodePreview">Kode: -</div>
              </div>
              <div class="masterField">
                <label for="masterNtmUnit">SATUAN</label>
                <select id="masterNtmUnit">
                  <option value="Pcs">Pcs</option>
                  <option value="Lembar">Lembar</option>
                  <option value="Keping">Keping</option>
                  <option value="Kg">Kg</option>
                  <option value="Roll">Roll</option>
                  <option value="Meter">Meter</option>
                  <option value="Box">Box</option>
                </select>
              </div>
            </div>
            <div class="masterFormMessage" id="masterNtmMessage"></div>
          </div>
          <div class="masterModalFooter">
            <button class="masterCancelBtn" data-ntm-master-close="1" type="button">BATAL</button>
            <button class="masterSaveBtn" id="masterNtmSaveBtn" type="submit">SIMPAN MATERIAL</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    $('masterNtmName')?.addEventListener('input',updateCodePreview);
    $('masterNtmForm')?.addEventListener('submit',saveFromModal);
    modal.addEventListener('click',e=>{
      if(e.target.closest?.('[data-ntm-master-close]'))closeModal();
    });
  }

  function updateCodePreview(){
    const name=$('masterNtmName')?.value||'';
    const code=editingCode||slugify(name);
    const el=$('masterNtmCodePreview');
    if(el)el.textContent=`Kode: ${code||'-'}`;
  }

  function renderMasterList(){
    const list=$('masterNtmList');
    if(!list)return;

    const q=String($('masterNtmSearch')?.value||'').trim().toLowerCase();
    const rows=activeTypes().filter(x=>
      !q ||
      String(x.name).toLowerCase().includes(q) ||
      String(x.code).toLowerCase().includes(q) ||
      String(x.unit).toLowerCase().includes(q)
    );

    const count=$('masterNtmCount');
    if(count)count.textContent=`${activeTypes().length} Material`;

    if(!rows.length){
      list.innerHTML='<div class="masterEmpty">Material NTM tidak ditemukan.</div>';
      return;
    }

    list.innerHTML=rows.map(item=>{
      const usage=ntmUsageCount(item.code);
      return `<div class="masterRow">
        <div class="masterRowMain">
          <span class="masterRowTitle"><i class="masterNtmColorDot" style="background:${esc(item.color)};color:${esc(item.color)}"></i>${esc(String(item.name).toUpperCase())}</span>
          <span class="masterRowSub">${usage?usage.toLocaleString('id-ID')+' data historis':'Belum dipakai data operasional'}</span>
          <span class="masterNtmUnitBadge">${esc(item.unit)}</span>
          ${item.is_system?'<span class="masterNtmSystemBadge">SYSTEM</span>':''}
        </div>
        <div class="masterRowActions">
          <button type="button" class="masterActionBtn edit" data-ntm-edit="${esc(item.code)}">Edit</button>
          <button type="button" class="masterNtmDelete" data-ntm-delete="${esc(item.code)}" ${item.is_system?'disabled title="Material sistem tidak dapat dihapus"':''}>Hapus</button>
        </div>
      </div>`;
    }).join('');
  }

  function openModal(code){
    editingCode=code||null;
    const item=code?getType(code):null;
    const modal=$('masterNtmModal');
    const title=$('masterNtmModalTitle');
    const name=$('masterNtmName');
    const unit=$('masterNtmUnit');
    const msg=$('masterNtmMessage');

    if(title)title.textContent=item?'Edit Material NTM':'Tambah Material NTM';
    if(name){
      name.value=item?.name||'';
      name.readOnly=!!item?.is_system;
    }
    if(unit){
      unit.value=item?.unit||'Pcs';
      unit.disabled=!!item?.is_system;
    }
    if(msg){msg.textContent='';msg.className='masterFormMessage';}

    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden','false');
    updateCodePreview();
    setTimeout(()=>name?.focus(),0);
  }

  function closeModal(){
    $('masterNtmModal')?.classList.remove('open');
    $('masterNtmModal')?.setAttribute('aria-hidden','true');
    $('masterNtmForm')?.reset();
    editingCode=null;
    const name=$('masterNtmName');if(name)name.readOnly=false;
    const unit=$('masterNtmUnit');if(unit)unit.disabled=false;
  }

  async function saveFromModal(e){
    e.preventDefault();

    if(currentRole()!=='admin'){
      alert('Hanya Admin yang dapat mengubah Master NTM.');
      return;
    }

    const sb=client();
    if(!sb){
      alert('Supabase belum tersedia.');
      return;
    }

    const msg=$('masterNtmMessage');
    const saveBtn=$('masterNtmSaveBtn');
    const name=String($('masterNtmName')?.value||'').trim();
    const unit=normalizeUnit($('masterNtmUnit')?.value);
    const existing=editingCode?getType(editingCode):null;

    if(!name){
      if(msg)msg.textContent='Nama material wajib diisi.';
      return;
    }

    let code=editingCode||slugify(name);
    if(!code){
      if(msg)msg.textContent='Nama material tidak dapat digunakan sebagai kode.';
      return;
    }

    if(!editingCode && master.some(x=>x.code===code && x.is_active!==false)){
      if(msg)msg.textContent='Material dengan nama/kode tersebut sudah ada.';
      return;
    }

    const usage=existing?ntmUsageCount(existing.code):0;
    if(existing && usage>0 && normalizeUnit(existing.unit)!==unit){
      if(msg)msg.textContent='Satuan material yang sudah memiliki data historis tidak dapat diubah.';
      return;
    }

    const sortOrder=existing?.sort_order || ((Math.max(0,...master.map(x=>Number(x.sort_order)||0))+10));
    const color=existing?.color || colorForIndex(master.length);

    try{
      if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='MENYIMPAN...';}

      const row={
        code,
        name,
        unit,
        color,
        sort_order:sortOrder,
        is_system:!!existing?.is_system,
        from_database:!!existing?.from_database,
        is_active:true,
        updated_at:new Date().toISOString()
      };

      const {error}=await sb
        .from('master_ntm_types')
        .upsert(row,{onConflict:'code'});

      if(error)throw error;

      await reloadAndApply();
      closeModal();
    }catch(err){
      console.error(err);
      if(msg)msg.textContent='Gagal menyimpan: '+(err?.message||err);
    }finally{
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='SIMPAN MATERIAL';}
    }
  }

  async function deactivate(code){
    if(currentRole()!=='admin'){
      alert('Hanya Admin yang dapat mengubah Master NTM.');
      return;
    }

    const item=getType(code);
    if(!item)return;
    if(item.is_system){
      alert('AMBRI adalah material sistem yang terhubung ke DATABASE 2026 dan tidak dapat dihapus.');
      return;
    }

    const usage=ntmUsageCount(code);
    const warning=usage
      ? `Material ${item.name} dipakai oleh ${usage.toLocaleString('id-ID')} data historis.\n\nMaterial akan dihapus dari pilihan aktif, card, trend, dan tombol riwayat. Data historis TIDAK akan dihapus.\n\nLanjutkan?`
      : `Hapus ${item.name} dari Master NTM?`;

    if(!confirm(warning))return;

    const sb=client();
    if(!sb)return;

    try{
      const {error}=await sb
        .from('master_ntm_types')
        .update({is_active:false,updated_at:new Date().toISOString()})
        .eq('code',code);
      if(error)throw error;
      await reloadAndApply();
    }catch(err){
      alert('Gagal menghapus material: '+(err?.message||err));
    }
  }

  function bindMasterActions(){
    document.addEventListener('click',e=>{
      const edit=e.target.closest?.('[data-ntm-edit]');
      if(edit){openModal(edit.dataset.ntmEdit);return;}

      const del=e.target.closest?.('[data-ntm-delete]');
      if(del && !del.disabled){deactivate(del.dataset.ntmDelete);return;}
    });

    document.addEventListener('keydown',e=>{
      if(e.key==='Escape' && $('masterNtmModal')?.classList.contains('open'))closeModal();
    });
  }

  async function reloadAndApply(){
    await fetchMaster();
    syncNtmTypesObject();
    renderMasterList();
    refreshAllNtmUI();
  }

  function subscribeRealtime(){
    const sb=client();
    if(!sb)return;

    try{
      realtimeChannel=sb
        .channel('master-ntm-types-live-v1')
        .on('postgres_changes',{
          event:'*',
          schema:'public',
          table:'master_ntm_types'
        },async function(){
          await reloadAndApply();
        })
        .subscribe();

      window.addEventListener('pagehide',()=>{
        try{sb.removeChannel(realtimeChannel)}catch(_){}
      },{once:true});
    }catch(err){
      console.warn('Realtime Master NTM gagal:',err);
    }
  }

  async function init(){
    injectMasterCard();
    injectModal();
    bindMasterActions();

    await fetchMaster();
    overrideRuntimeFunctions();
    renderMasterList();
    refreshAllNtmUI();
    subscribeRealtime();

    window.NCTMasterNTM={
      list:()=>master.slice(),
      active:()=>activeTypes().slice(),
      reload:reloadAndApply
    };
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();
