
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const DATASETS=[
    {key:'giling_dashboard_2026_v4_clean',label:'Produksi Giling',sheet:'Produksi',dateFields:['date']},
    {key:'quality_incoming_tobacco_v1',label:'Quality Incoming',sheet:'Quality Incoming',dateFields:['tobaccoDate','productionBlendingDate','arrivalBrakDate']},
    {key:'qgg_quality_sampling_progress_v1',label:'Quality Giling & Gunting',sheet:'Quality Giling',dateFields:['date']},
    {key:'ntm_waste_2026_v2',label:'Waste Produksi',sheet:'Waste Produksi',dateFields:['date']}
  ];
  let mode='daily';

  function parseStore(key,fallback){
    try{const x=JSON.parse(localStorage.getItem(key)||'null');return x==null?fallback:x}catch(_){return fallback}
  }
  function rowsFor(ds){const x=parseStore(ds.key,[]);return Array.isArray(x)?x:[]}
  function isoDate(v){
    const s=String(v||'').trim();if(!s)return '';
    let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
    m=s.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);if(m)return `${m[3]}-${m[2]}-${m[1]}`;
    const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
  }
  function rowDate(row,fields){
    for(const f of fields||[]){const d=isoDate(row&&row[f]);if(d)return d}
    for(const k of Object.keys(row||{})){if(/date|tanggal/i.test(k)){const d=isoDate(row[k]);if(d)return d}}
    return '';
  }
  function range(){
    if(mode==='monthly')return {start:$('backupStartMonth')?.value||'',end:$('backupEndMonth')?.value||''};
    return {start:$('backupStartDate')?.value||'',end:$('backupEndDate')?.value||''};
  }
  function validRange(show){
    const r=range();
    if(!r.start||!r.end){if(show)setStatus('Lengkapi periode awal dan akhir.',true);return null}
    if(r.start>r.end){if(show)setStatus('Periode awal tidak boleh melebihi periode akhir.',true);return null}
    return r;
  }
  function filterRows(ds,rows,r){
    return rows.filter(row=>{
      const d=rowDate(row,ds.dateFields);if(!d)return false;
      const key=mode==='monthly'?d.slice(0,7):d;
      return key>=r.start&&key<=r.end;
    });
  }
  function escapeText(v){return String(v??'')}
  function flatten(obj,prefix='',out={}){
    if(obj===null||obj===undefined){if(prefix)out[prefix]='';return out}
    if(Array.isArray(obj)){out[prefix||'value']=JSON.stringify(obj);return out}
    if(typeof obj!=='object'){out[prefix||'value']=obj;return out}
    Object.keys(obj).forEach(k=>{
      const key=prefix?`${prefix}.${k}`:k,v=obj[k];
      if(v&&typeof v==='object'&&!Array.isArray(v))flatten(v,key,out);
      else out[key]=Array.isArray(v)?JSON.stringify(v):v;
    });return out;
  }
  function setStatus(msg,error=false){const el=$('backupStatus');if(!el)return;el.textContent=msg||'';el.classList.toggle('error',!!error)}
  function counts(r){
    return DATASETS.map(ds=>({ds,rows:filterRows(ds,rowsFor(ds),r)}));
  }
  function renderSummary(){
    const list=$('backupDatasetList'),total=$('backupTotalRecords');if(!list||!total)return;
    const r=validRange(false);
    const result=r?counts(r):DATASETS.map(ds=>({ds,rows:[]}));
    list.innerHTML=result.map(x=>`<div class="backupDatasetItem"><span class="backupDatasetDot"></span><span class="backupDatasetText"><b>${x.ds.label}</b><small>${mode==='daily'?'berdasarkan tanggal':'berdasarkan bulan'} pilihan</small></span><span class="backupDatasetCount">${x.rows.length.toLocaleString('id-ID')}</span></div>`).join('');
    total.textContent=result.reduce((n,x)=>n+x.rows.length,0).toLocaleString('id-ID');
    const sub=$('backupDownloadSub');if(sub&&r)sub.textContent=`${r.start}  →  ${r.end}`;
  }
  function setMode(next){
    mode=next==='monthly'?'monthly':'daily';
    document.querySelectorAll('[data-backup-mode]').forEach(b=>b.classList.toggle('active',b.dataset.backupMode===mode));
    $('backupDailyPanel')?.classList.toggle('active',mode==='daily');
    $('backupMonthlyPanel')?.classList.toggle('active',mode==='monthly');
    setStatus('');renderSummary();
  }
  function openPicker(id){
    const el=$(id);if(!el)return;
    try{if(typeof el.showPicker==='function'){el.showPicker();return}}catch(_){ }
    try{el.focus();el.click()}catch(_){ }
  }
  function today(){return new Date().toISOString().slice(0,10)}
  function initDates(){
    const now=new Date(),end=today(),start=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10),month=end.slice(0,7);
    if($('backupStartDate')&&!$('backupStartDate').value)$('backupStartDate').value=start;
    if($('backupEndDate')&&!$('backupEndDate').value)$('backupEndDate').value=end;
    if($('backupStartMonth')&&!$('backupStartMonth').value)$('backupStartMonth').value=month;
    if($('backupEndMonth')&&!$('backupEndMonth').value)$('backupEndMonth').value=month;
  }
  function aoaSheet(rows){return XLSX.utils.json_to_sheet(rows.length?rows:[{Keterangan:'Tidak ada data pada periode yang dipilih'}])}
  function appendSheet(wb,name,rows){XLSX.utils.book_append_sheet(wb,aoaSheet(rows),name.slice(0,31))}
  function qggDetails(records){
    const weights=[],diameter=[],visual=[];
    records.forEach(r=>{
      const base={Tanggal:r.date||'',Mode:r.mode||'',Unit:r.unit||'',Sampling:r.samplingNo||'',Brand:r.brand||'',Inspektor:r.inspector||''};
      const raw=r.raw||{};
      (Array.isArray(raw.weights)?raw.weights:[]).forEach((v,i)=>weights.push({...base,'No Sampel':i+1,'Berat':v}));
      if(raw.diameter&&typeof raw.diameter==='object')diameter.push({...base,'ME Inspec':r.diameterMEInspec??'','ME Mapak':raw.diameter.meMapak??0,'ME Merit':raw.diameter.meMerit??0,'BE Inspec':r.diameterBEInspec??'','BE Mekar':raw.diameter.beMekar??0,'BE Mingkup':raw.diameter.beMingkup??0});
      (Array.isArray(raw.visual)?raw.visual:[]).forEach(v=>visual.push({...base,'Jenis Defect':v.defect||'','Category':v.category||'','Jumlah':v.value??0}));
    });return {weights,diameter,visual};
  }
  async function refreshSupabase(){
    try{if(window.NCTSupabase?.prepareSharedState&&window.NCT_USER_CONTEXT)await window.NCTSupabase.prepareSharedState(window.NCT_USER_CONTEXT)}catch(e){console.warn('Backup refresh skipped',e)}
  }
  async function download(){
    const r=validRange(true);if(!r)return;
    const btn=$('backupDownloadBtn');if(btn)btn.disabled=true;setStatus('Menyiapkan data terbaru...');
    try{
      await refreshSupabase();
      if(typeof XLSX==='undefined')throw new Error('Library Excel belum tersedia. Muat ulang halaman dan coba lagi.');
      const result=counts(r),wb=XLSX.utils.book_new(),now=new Date();
      const info=[
        {Parameter:'Waktu Backup',Nilai:now.toLocaleString('id-ID')},
        {Parameter:'User',Nilai:window.NCT_USER_CONTEXT?.profile?.username||window.NCT_USER_CONTEXT?.profile?.name||''},
        {Parameter:'Role',Nilai:window.NCT_USER_CONTEXT?.profile?.role||''},
        {Parameter:'Jenis Periode',Nilai:mode==='daily'?'Harian':'Bulanan'},
        {Parameter:'Periode Awal',Nilai:r.start},{Parameter:'Periode Akhir',Nilai:r.end},
        ...result.map(x=>({Parameter:`Jumlah ${x.ds.label}`,Nilai:x.rows.length}))
      ];
      appendSheet(wb,'INFO BACKUP',info);
      result.forEach(x=>appendSheet(wb,x.ds.sheet,x.rows.map(row=>flatten(row))));
      const qgg=result.find(x=>x.ds.key==='qgg_quality_sampling_progress_v1');
      if(qgg){const d=qggDetails(qgg.rows);appendSheet(wb,'QGG Berat',d.weights);appendSheet(wb,'QGG Diameter',d.diameter);appendSheet(wb,'QGG Visual',d.visual)}
      const stocks=parseStore('giling_initial_stocks_v2',{});
      const stockRows=Object.keys(stocks||{}).map(brand=>({Brand:brand,'Stok Awal':stocks[brand]}));
      appendSheet(wb,'Stok Awal',stockRows);
      const safe=s=>String(s).replace(/[^0-9A-Za-z_-]+/g,'-');
      const filename=`Backup_Dashboard_${mode==='daily'?'Harian':'Bulanan'}_${safe(r.start)}_sd_${safe(r.end)}.xlsx`;
      XLSX.writeFile(wb,filename,{compression:true});
      setStatus(`Backup berhasil dibuat: ${filename}`);renderSummary();
    }catch(e){console.error(e);setStatus(e.message||'Backup gagal dibuat.',true)}finally{if(btn)btn.disabled=false}
  }
  function bind(){
    document.querySelectorAll('[data-backup-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.backupMode)));
    document.querySelectorAll('.backupPickerBtn').forEach(b=>b.addEventListener('click',()=>openPicker(b.dataset.picker)));
    ['backupStartDate','backupEndDate','backupStartMonth','backupEndMonth'].forEach(id=>$(id)?.addEventListener('change',()=>{setStatus('');renderSummary()}));
    $('backupDownloadBtn')?.addEventListener('click',download);
  }
  function init(){initDates();bind();setMode('daily')}
  window.NCTBackupData={onOpen:function(){initDates();renderSummary()},render:renderSummary,download};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
