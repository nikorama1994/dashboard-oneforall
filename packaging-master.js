(function(){
  'use strict';

  const TABLE='master_packaging_brands';
  const BLEND_MASTER_KEY='nct_master_brands_v1';
  const FALLBACK_BLEND=['JNA','JNB','JNK','MAT'];

  let rows=[];
  let editingCode=null;
  let realtimeChannel=null;

  const $=id=>document.getElementById(id);

  function esc(v){
    return String(v??'').replace(/[&<>"']/g,c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function normalizeBrand(v){
    return String(v||'')
      .trim()
      .toUpperCase()
      .replace(/\s+/g,' ')
      .slice(0,40);
  }

  function codeFromName(v){
    return normalizeBrand(v)
      .replace(/[^A-Z0-9._-]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .slice(0,40);
  }

  function role(){
    let r=String(window.NCT_USER_CONTEXT?.profile?.role||'guest_internal').toLowerCase();
    if(r==='viewer')r='guest_internal';
    return r;
  }

  function client(){
    return window.NCTSupabase?.client||null;
  }

  function active(){
    return rows
      .filter(x=>x.is_active!==false)
      .sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||String(a.name).localeCompare(String(b.name),'id'));
  }

  function currentBlendMaster(){
    try{
      const raw=JSON.parse(localStorage.getItem(BLEND_MASTER_KEY)||'null');
      if(Array.isArray(raw)&&raw.length){
        return [...new Set(raw.map(normalizeBrand).filter(Boolean))];
      }
    }catch(_){}
    return FALLBACK_BLEND.slice();
  }

  async function fetchRows(){
    const sb=client();
    if(!sb){
      rows=[];
      return rows;
    }

    const {data,error}=await sb
      .from(TABLE)
      .select('code,name,sort_order,is_active,created_at,updated_at')
      .order('sort_order',{ascending:true})
      .order('name',{ascending:true});

    if(error)throw error;
    rows=Array.isArray(data)?data:[];
    return rows;
  }

  async function seedFromBlendIfEmpty(){
    if(rows.length || role()!=='admin')return;
    const sb=client();
    if(!sb)return;

    const list=currentBlendMaster();
    if(!list.length)return;

    const payload=list.map((name,i)=>({
      code:codeFromName(name),
      name:normalizeBrand(name),
      sort_order:(i+1)*10,
      is_active:true
    })).filter(x=>x.code&&x.name);

    if(!payload.length)return;

    const {error}=await sb.from(TABLE).upsert(payload,{onConflict:'code'});
    if(error)throw error;

    await fetchRows();
  }

  function optionMarkup(firstLabel,firstValue=''){
    let html=firstLabel!=null
      ? `<option value="${esc(firstValue)}">${esc(firstLabel)}</option>`
      : '';
    html+=active().map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
    return html;
  }

  function populateSelect(el,firstLabel='Pilih Brand Packaging',firstValue=''){
    if(!el)return;
    const current=el.value;
    const list=active();
    el.innerHTML=optionMarkup(firstLabel,firstValue);

    if(list.some(x=>x.code===current) || current===firstValue){
      el.value=current;
    }else if(firstLabel==null && list[0]){
      el.value=list[0].code;
    }else{
      el.value=firstValue;
    }

    el.disabled=!list.length;
    if(!list.length){
      el.innerHTML='<option value="">Belum ada Brand Packaging</option>';
    }
  }

  function refreshBindings(){
    document.querySelectorAll('[data-packaging-brand-select]').forEach(el=>{
      const first=el.dataset.packagingBrandAll==='1'?'Semua Brand Packaging':'Pilih Brand Packaging';
      populateSelect(el,first,'');
    });

    try{
      document.dispatchEvent(new CustomEvent('nct-packaging-brands-changed',{
        detail:{brands:active().map(x=>({...x}))}
      }));
    }catch(_){}
  }

  function injectSettingsCard(){
    const grid=document.querySelector('#settings .masterSettingsGrid');
    if(!grid||$('masterPackagingBrandCard'))return;

    const blendCard=grid.querySelector('.masterBrandCard');
    const card=document.createElement('section');
    card.className='masterCard masterPackagingBrandCard';
    card.id='masterPackagingBrandCard';
    card.innerHTML=`
      <div class="masterCardHead">
        <div class="masterCardTitle">
          <span aria-hidden="true" class="masterCardIcon">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M4 12l8 4.5 8-4.5M4 16.5 12 21l8-4.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            </svg>
          </span>
          <div>
            <h3>Master Brand Packaging</h3>
            <p>Brand khusus untuk Produksi Packaging dan Quality Packaging. Terpisah dari Master Blend for Brand.</p>
          </div>
        </div>
        <button class="masterAddBtn" id="masterAddPackagingBrandBtn" type="button">+ TAMBAH</button>
      </div>
      <div class="masterSearchWrap">
        <input autocomplete="off" id="masterPackagingBrandSearch" placeholder="Cari Brand Packaging..." type="search"/>
      </div>
      <div class="masterList" id="masterPackagingBrandList"></div>
      <div class="masterListFoot"><span id="masterPackagingBrandCount">0 Brand Packaging</span></div>
    `;

    // Letakkan tepat setelah Master Blend for Brand.
    if(blendCard?.nextSibling)grid.insertBefore(card,blendCard.nextSibling);
    else grid.appendChild(card);

    $('masterAddPackagingBrandBtn')?.addEventListener('click',()=>openModal());
    $('masterPackagingBrandSearch')?.addEventListener('input',renderList);
  }

  function injectModal(){
    if($('masterPackagingBrandModal'))return;

    const modal=document.createElement('div');
    modal.className='masterModal';
    modal.id='masterPackagingBrandModal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML=`
      <div class="masterModalBackdrop" data-packaging-brand-close="1"></div>
      <div class="masterModalDialog small" role="dialog" aria-modal="true" aria-labelledby="masterPackagingBrandModalTitle">
        <div class="masterModalHead">
          <div>
            <div class="masterSettingsEyebrow">MASTER PACKAGING</div>
            <h3 id="masterPackagingBrandModalTitle">Tambah Brand Packaging</h3>
          </div>
          <button class="masterModalClose" data-packaging-brand-close="1" type="button">×</button>
        </div>
        <form id="masterPackagingBrandForm">
          <div class="masterModalBody">
            <div class="masterField">
              <label for="masterPackagingBrandName">NAMA / KODE BRAND PACKAGING</label>
              <input id="masterPackagingBrandName" maxlength="40" placeholder="Contoh: JNA" required type="text"/>
              <div class="masterPackagingCodePreview" id="masterPackagingBrandCodePreview">Kode: -</div>
            </div>
            <div class="masterFormMessage" id="masterPackagingBrandMessage"></div>
          </div>
          <div class="masterModalFooter">
            <button class="masterCancelBtn" data-packaging-brand-close="1" type="button">BATAL</button>
            <button class="masterSaveBtn" id="masterPackagingBrandSaveBtn" type="submit">SIMPAN BRAND</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    $('masterPackagingBrandName')?.addEventListener('input',updateCodePreview);
    $('masterPackagingBrandForm')?.addEventListener('submit',saveModal);
    modal.addEventListener('click',e=>{
      if(e.target.closest?.('[data-packaging-brand-close]'))closeModal();
    });
  }

  function updateCodePreview(){
    const name=$('masterPackagingBrandName')?.value||'';
    const code=editingCode||codeFromName(name);
    const el=$('masterPackagingBrandCodePreview');
    if(el)el.textContent=`Kode: ${code||'-'}`;
  }

  function renderList(){
    const list=$('masterPackagingBrandList');
    if(!list)return;

    const q=String($('masterPackagingBrandSearch')?.value||'').trim().toLowerCase();
    const data=active().filter(x=>
      !q ||
      String(x.name).toLowerCase().includes(q) ||
      String(x.code).toLowerCase().includes(q)
    );

    const count=$('masterPackagingBrandCount');
    if(count)count.textContent=`${active().length} Brand Packaging`;

    if(!data.length){
      list.innerHTML='<div class="masterEmpty">Brand Packaging belum tersedia.</div>';
      return;
    }

    list.innerHTML=data.map(x=>`
      <div class="masterRow">
        <div class="masterRowMain">
          <span class="masterRowTitle">${esc(x.name)}</span>
          <span class="masterRowSub">Khusus Produksi Packaging &amp; Quality Packaging</span>
          <span class="masterPackagingBrandCode">${esc(x.code)}</span>
        </div>
        <div class="masterRowActions">
          <button type="button" class="masterActionBtn edit" data-packaging-brand-edit="${esc(x.code)}">Edit</button>
          <button type="button" class="masterPackagingBrandDelete" data-packaging-brand-delete="${esc(x.code)}">Hapus</button>
        </div>
      </div>
    `).join('');
  }

  function find(code){
    return rows.find(x=>x.code===code)||null;
  }

  function openModal(code){
    if(role()!=='admin'){
      alert('Hanya Admin yang dapat mengubah Master Brand Packaging.');
      return;
    }

    editingCode=code||null;
    const item=code?find(code):null;
    const modal=$('masterPackagingBrandModal');
    const title=$('masterPackagingBrandModalTitle');
    const input=$('masterPackagingBrandName');
    const msg=$('masterPackagingBrandMessage');

    if(title)title.textContent=item?'Edit Brand Packaging':'Tambah Brand Packaging';
    if(input)input.value=item?.name||'';
    if(msg){msg.textContent='';msg.className='masterFormMessage';}

    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden','false');
    updateCodePreview();
    setTimeout(()=>input?.focus(),0);
  }

  function closeModal(){
    $('masterPackagingBrandModal')?.classList.remove('open');
    $('masterPackagingBrandModal')?.setAttribute('aria-hidden','true');
    $('masterPackagingBrandForm')?.reset();
    editingCode=null;
  }

  async function saveModal(e){
    e.preventDefault();

    if(role()!=='admin'){
      alert('Hanya Admin yang dapat mengubah Master Brand Packaging.');
      return;
    }

    const sb=client();
    if(!sb){
      alert('Supabase belum tersedia.');
      return;
    }

    const input=$('masterPackagingBrandName');
    const msg=$('masterPackagingBrandMessage');
    const saveBtn=$('masterPackagingBrandSaveBtn');
    const name=normalizeBrand(input?.value||'');

    if(!name){
      if(msg)msg.textContent='Nama Brand Packaging wajib diisi.';
      return;
    }

    let code=editingCode||codeFromName(name);
    if(!code){
      if(msg)msg.textContent='Nama Brand Packaging tidak valid.';
      return;
    }

    if(!editingCode && rows.some(x=>x.code===code && x.is_active!==false)){
      if(msg)msg.textContent='Brand Packaging tersebut sudah ada.';
      return;
    }

    const existing=editingCode?find(editingCode):null;
    const sortOrder=existing?.sort_order || (Math.max(0,...rows.map(x=>Number(x.sort_order)||0))+10);

    try{
      if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='MENYIMPAN...';}

      const payload={
        code,
        name,
        sort_order:sortOrder,
        is_active:true,
        updated_at:new Date().toISOString()
      };

      const {error}=await sb.from(TABLE).upsert(payload,{onConflict:'code'});
      if(error)throw error;

      await reload();
      closeModal();
    }catch(err){
      console.error(err);
      if(msg)msg.textContent='Gagal menyimpan: '+(err?.message||err);
    }finally{
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='SIMPAN BRAND';}
    }
  }

  async function deactivate(code){
    if(role()!=='admin'){
      alert('Hanya Admin yang dapat mengubah Master Brand Packaging.');
      return;
    }

    const item=find(code);
    if(!item)return;

    if(!confirm(`Hapus ${item.name} dari Master Brand Packaging?\n\nBrand hanya dinonaktifkan dari pilihan Packaging. Data historis Packaging di masa depan tidak akan ikut dihapus.`))return;

    const sb=client();
    if(!sb)return;

    try{
      const {error}=await sb
        .from(TABLE)
        .update({is_active:false,updated_at:new Date().toISOString()})
        .eq('code',code);
      if(error)throw error;
      await reload();
    }catch(err){
      alert('Gagal menghapus Brand Packaging: '+(err?.message||err));
    }
  }

  function bindActions(){
    document.addEventListener('click',e=>{
      const edit=e.target.closest?.('[data-packaging-brand-edit]');
      if(edit){openModal(edit.dataset.packagingBrandEdit);return;}

      const del=e.target.closest?.('[data-packaging-brand-delete]');
      if(del){deactivate(del.dataset.packagingBrandDelete);return;}
    });

    document.addEventListener('keydown',e=>{
      if(e.key==='Escape' && $('masterPackagingBrandModal')?.classList.contains('open'))closeModal();
    });
  }

  async function reload(){
    await fetchRows();
    renderList();
    refreshBindings();
  }

  function subscribeRealtime(){
    const sb=client();
    if(!sb)return;

    try{
      realtimeChannel=sb
        .channel('master-packaging-brands-live-v1')
        .on('postgres_changes',{
          event:'*',
          schema:'public',
          table:TABLE
        },async()=>{await reload();})
        .subscribe();

      window.addEventListener('pagehide',()=>{
        try{sb.removeChannel(realtimeChannel)}catch(_){}
      },{once:true});
    }catch(err){
      console.warn('Realtime Master Brand Packaging gagal:',err);
    }
  }

  async function init(){
    injectSettingsCard();
    injectModal();
    bindActions();

    try{
      await fetchRows();
      await seedFromBlendIfEmpty();
    }catch(err){
      console.warn('Master Brand Packaging belum siap:',err);
    }

    renderList();
    refreshBindings();
    subscribeRealtime();

    window.NCTPackagingBrandMaster={
      list:()=>rows.map(x=>({...x})),
      active:()=>active().map(x=>({...x})),
      reload,
      populateSelect
    };
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',init,{once:true});
  }else{
    init();
  }
})();
