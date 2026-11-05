/* Laporan Operasional Produksi SKT - PDF A4. Add-on read-only for the Backup Data page.
   Data remains in existing Excel/manual/Supabase stores; no write or schema changes. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const PROD_KEY='giling_dashboard_2026_v4_clean';
  const QIT_KEY='quality_incoming_tobacco_v1';
  const QGG_KEY='qgg_quality_sampling_progress_v1';
  const NAMES=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const SHORT=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const COLORS={navy:'#182A4B',ink:'#263A51',mute:'#7B8D9F',cyan:'#38A8CF',blue:'#4B9ED7',teal:'#149E9B',pale:'#EDF6FA',light:'#F4F8FC',line:'#DCE6F0',white:'#FFFFFF',pink:'#DE7187',palePink:'#F7E6E9'};
  let mode='weekly',year='',brand='',selectedWeek='',selectedMonth='',selectedQuarter='1';
  let cachedSummary=null;
  const n=(v)=>{
    if(v===null||v===undefined||String(v).trim()==='')return 0;
    if(typeof v==='number')return Number.isFinite(v)?v:0;
    let s=String(v).replace(/\s/g,'');
    if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(s.includes(','))s=s.replace(',','.');
    const val=Number(s);return Number.isFinite(val)?val:0;
  };
  const has=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
  const normBrand=v=>String(v||'').trim().toUpperCase();
  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  function store(key){try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v:[]}catch(_){return []}}
  function dateKey(v){
    const s=String(v||'').trim();if(!s)return '';
    const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(iso)return iso[0];
    const id=s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);if(id)return `${id[3]}-${id[2].padStart(2,'0')}-${id[1].padStart(2,'0')}`;
    return '';
  }
  const df=s=>{const k=dateKey(s);return k?`${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(2,4)}`:'-'};
  const fmt=(v,dec=0)=>Number.isFinite(v)?v.toLocaleString('id-ID',{minimumFractionDigits:dec,maximumFractionDigits:dec}):'-';
  function isoWeek(d){
    const x=new Date(`${dateKey(d)}T12:00:00Z`);if(Number.isNaN(x.getTime()))return 0;
    x.setUTCDate(x.getUTCDate()+4-(x.getUTCDay()||7));const jan=new Date(Date.UTC(x.getUTCFullYear(),0,1));return Math.ceil(((x-jan)/86400000+1)/7);
  }
  function weekOf(r){const v=n(r.week);return v>=1&&v<=53?Math.floor(v):isoWeek(r.date)}
  function productionRows(){return store(PROD_KEY).filter(r=>dateKey(r.date)&&n(r.actual)>0).map(r=>({...r,__day:dateKey(r.date),__week:weekOf(r),__brand:normBrand(r.brand)}));}
  function sourceData(){
    const p=productionRows();
    const yi=[...new Set(p.map(r=>r.__day.slice(0,4)))].sort().reverse();
    if(!yi.length)yi.push(String(new Date().getFullYear()));
    return {p,years:yi,brands:[...new Set(p.map(r=>r.__brand).filter(Boolean))].sort(),quality:store(QGG_KEY),incoming:store(QIT_KEY)};
  }
  function setSelect(id,values,current){
    const sel=$(id);if(!sel)return '';
    sel.replaceChildren();values.forEach(item=>sel.add(new Option(item.text,item.value)));
    if(values.some(x=>x.value===current))sel.value=current;
    else if(values.length)sel.value=values[0].value;
    return sel.value;
  }
  function periodInfo(rows){
    const yy=Number(year)||new Date().getFullYear();
    let start,end,tag,kind;
    if(mode==='weekly'){
      const wr=rows.filter(r=>r.__day.slice(0,4)===year&&String(r.__week)===selectedWeek);
      const days=wr.map(r=>r.__day).sort();
      const first=days[0],last=days[days.length-1];
      if(!first)return null;
      const monday=new Date(`${first}T12:00:00Z`);
      monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
      const sunday=new Date(`${last}T12:00:00Z`);sunday.setUTCDate(sunday.getUTCDate()+(7-(sunday.getUTCDay()||7)));
      start=monday.toISOString().slice(0,10);end=sunday.toISOString().slice(0,10);
      kind='Mingguan';tag=`Week ${selectedWeek}`;
    }else if(mode==='monthly'){
      const mo=Number(selectedMonth)||1;
      start=`${yy}-${String(mo).padStart(2,'0')}-01`;
      end=new Date(Date.UTC(yy,mo,0)).toISOString().slice(0,10);
      kind='Bulanan';tag=NAMES[mo-1];
    }else if(mode==='quarterly'){
      const q=Number(selectedQuarter)||1;const sm=(q-1)*3+1;
      start=`${yy}-${String(sm).padStart(2,'0')}-01`;
      end=new Date(Date.UTC(yy,sm+2,0)).toISOString().slice(0,10);
      kind='Triwulanan';tag=`Q${q} ${yy}`;
    }else{start=`${yy}-01-01`;end=`${yy}-12-31`;kind='Tahunan';tag=String(yy)}
    return {start,end,year:yy,tag,kind,mode,range:`${df(start)} - ${df(end)}`};
  }
  function selectRecords(p,period){
    if(!period)return [];
    return p.filter(r=>(mode==='weekly'?r.__day.slice(0,4)===year&&String(r.__week)===selectedWeek:r.__day>=period.start&&r.__day<=period.end)&&(!brand||r.__brand===brand))
      .sort((a,b)=>a.__day.localeCompare(b.__day)||a.__brand.localeCompare(b.__brand));
  }
  function refreshOptions(){
    const src=sourceData();
    year=setSelect('rptYear',src.years.map(y=>({value:y,text:y})),year);
    brand=setSelect('rptBrand',[{value:'',text:'SEMUA BRAND'},...src.brands.map(b=>({value:b,text:b}))],brand);
    const active=src.p.filter(r=>r.__day.slice(0,4)===year&&(!brand||r.__brand===brand));
    const weeks=[...new Set(active.map(r=>r.__week))].filter(Boolean).sort((a,b)=>b-a);
    selectedWeek=setSelect('rptWeek',weeks.map(w=>({value:String(w),text:`Week ${w}`})),selectedWeek);
    const months=[...new Set(active.map(r=>Number(r.__day.slice(5,7))))].sort((a,b)=>b-a);
    selectedMonth=setSelect('rptMonth',months.map(m=>({value:String(m),text:NAMES[m-1]})),selectedMonth);
    selectedQuarter=setSelect('rptQuarter',[1,2,3,4].map(q=>({value:String(q),text:`Q${q} - ${SHORT[(q-1)*3]} s.d. ${SHORT[q*3-1]}`})),selectedQuarter);
    for(const [id,on] of [['rptWeekField',mode==='weekly'],['rptMonthField',mode==='monthly'],['rptQuarterField',mode==='quarterly']])$(id)?.classList.toggle('rptHidden',!on);
    document.querySelectorAll('[data-report-mode]').forEach(b=>{
      b.classList.toggle('active',b.dataset.reportMode===mode);b.setAttribute('aria-pressed',b.dataset.reportMode===mode?'true':'false');
    });
    const info=periodInfo(src.p),selected=selectRecords(src.p,info);
    cachedSummary={...src,period:info,selected};
    const quality=info?src.quality.filter(r=>dateKey(r.date)>=info.start&&dateKey(r.date)<=info.end&&(!brand||normBrand(r.brand)===brand)):[];
    const inc=info?src.incoming.filter(r=>dateKey(r.tobaccoDate)>=info.start&&dateKey(r.tobaccoDate)<=info.end&&(!brand||normBrand(r.brand)===brand)):[];
    if($('rptSummaryText'))$('rptSummaryText').textContent=info?`${info.range}  •  ${info.tag}  •  ${selected.length.toLocaleString('id-ID')} data produksi  •  ${quality.length} data sampling Quality  •  ${inc.length} Quality Incoming`:'Belum ada data produksi untuk tahun dan brand ini.';
    if($('rptDownloadBtn'))$('rptDownloadBtn').disabled=!selected.length;
  }
  function setStatus(text,isErr){const el=$('rptStatus');if(!el)return;el.textContent=text||'';el.classList.toggle('error',!!isErr)}
  function stats(rows){
    const z={use:0,kritik:0,actual:0,theory:0,sapon:0,gagang:0,waste:0,ambriWaste:0,ambriTotal:0,ambriRatioSum:0,ambriRatioN:0};
    rows.forEach(r=>{
      z.use+=n(r.use);z.kritik+=n(r.kritik);z.actual+=n(r.actual);
      // The theoretical production remains an existing yield denominator, not a report column.
      const th=n(r.theory)>0?n(r.theory):(n(r.use)>0?n(r.use)*1000/1.65:0);
      z.theory+=th;z.sapon+=n(r.sapon);z.gagang+=n(r.gagang);
      // Excel menyimpan Total Waste tersendiri; tidak selalu ada data Sapon/Gagang.
      // Pada input manual, Total Waste tetap sama dengan Sapon + Gagang.
      z.waste+=has(r.totalWaste)?n(r.totalWaste):(n(r.sapon)+n(r.gagang));
      const wA=has(r.wasteAmbri)?n(r.wasteAmbri):has(r.excelWasteAmbri)?n(r.excelWasteAmbri):null;
      const useA=has(r.useAmbri)?n(r.useAmbri):has(r.excelUseAmbri)?n(r.excelUseAmbri):null;
      const totalA=has(r.totalUseAmbri)?n(r.totalUseAmbri):has(r.excelTotalUseAmbri)?n(r.excelTotalUseAmbri):null;
      if(wA!==null){
        const base=totalA!==null&&totalA>0?totalA:(useA!==null&&useA+wA>0?useA+wA:0);
        if(base>0){z.ambriWaste+=wA;z.ambriTotal+=base;}
      }
      if(has(r.wasteAmbriPct)){let v=n(r.wasteAmbriPct);if(Math.abs(v)>1)v/=100;z.ambriRatioSum+=v;z.ambriRatioN++;}
    });
    z.weight=z.actual>0?z.use*1000/z.actual:null;
    z.yield=z.theory>0?z.actual/z.theory*100:null;
    z.ambriPct=z.ambriTotal>0?100*z.ambriWaste/z.ambriTotal:(z.ambriRatioN?100*z.ambriRatioSum/z.ambriRatioN:null);
    return z;
  }
  function groups(rows,per){
    const map=new Map();
    rows.forEach(r=>{
      const month=Number(r.__day.slice(5,7)),week=r.__week;
      let key,label,monthLabel='';
      if(per.mode==='weekly'){key=r.__day;label=df(r.__day);}
      else if(per.mode==='yearly'){key=r.__day.slice(0,7);label=SHORT[month-1];}
      else{key=(per.mode==='quarterly'?String(month).padStart(2,'0')+'|':'')+week;label=`W${week}`;monthLabel=SHORT[month-1];}
      if(!map.has(key))map.set(key,{key,label,monthLabel,date:r.__day,rows:[]});
      map.get(key).rows.push(r);
      if(r.__day<map.get(key).date)map.get(key).date=r.__day;
    });
    return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(g=>({...g,s:stats(g.rows)}));
  }
  function qualityStats(qRows,iRows){
    const q={mcSend:null,mcReceive:null,samples:{MK:null,SA:null},inspect:{},physical:[],visual:[]};
    const average=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
    q.mcSend=average(iRows.filter(r=>has(r.mcSend)).map(r=>n(r.mcSend)));
    q.mcReceive=average(iRows.filter(r=>has(r.mcReceive)).map(r=>n(r.mcReceive)));
    const physCounts=new Map([['Berat rokok',0],['ME Mapak',0],['ME Merit',0],['BE Mekar',0],['BE Mingkup',0]]);
    const visCounts=new Map();
    for(const modeName of ['MK','SA']){
      const rows=qRows.filter(r=>String(r.mode||'').toUpperCase()===modeName);
      const weights=[];
      const t={pIn:0,pTotal:0,vOut:0,vTotal:0};
      rows.forEach(r=>{
        const raw=r.raw||{};
        (Array.isArray(raw.weights)?raw.weights:[]).forEach(x=>{if(has(x)&&n(x)>0)weights.push(n(x))});
        const wt=n(r.weightTotal),wi=Math.min(wt,n(r.weightInspec));
        const dt=n(r.diameterTotal),me=Math.min(dt,n(r.diameterMEInspec)),be=Math.min(dt,n(r.diameterBEInspec));
        t.pIn+=wi+me+be;t.pTotal+=wt+2*dt;
        physCounts.set('Berat rokok',physCounts.get('Berat rokok')+Math.max(0,wt-wi));
        const rd=raw.diameter||{};
        let countedDiameter=0;
        for(const [label,key] of [['ME Mapak','meMapak'],['ME Merit','meMerit'],['BE Mekar','beMekar'],['BE Mingkup','beMingkup']]){const count=n(rd[key]);physCounts.set(label,physCounts.get(label)+count);countedDiameter+=count;}
        const otherDiameter=Math.max(0,(2*dt-me-be)-countedDiameter);
        if(otherDiameter>0)physCounts.set('Diameter lainnya',(physCounts.get('Diameter lainnya')||0)+otherDiameter);
        const sample=n(r.sampleCount||r.visualTotalUnits);
        const items=Array.isArray(raw.visual)?raw.visual:[];
        const rowDefects=new Map();
        items.forEach(item=>{
          if(String(item.category||'').trim().toUpperCase()!=='A')return;
          const label=String(item.defect||'').trim();if(!label)return;
          const value=Math.max(0,n(item.value));
          visCounts.set(label,(visCounts.get(label)||0)+value);
          rowDefects.set(label,(rowDefects.get(label)||0)+value);
        });
        // Existing dashboard calculates Visual In/Out per defect (Category A).
        // Per mode, average over all 25 visual defect types and samples.
        if(sample>0){t.vTotal+=sample*25;t.vOut+=[...rowDefects.values()].reduce((a,v)=>a+Math.min(v,sample),0);}
      });
      q.samples[modeName]=average(weights);
      q.inspect[modeName]={physical:t.pTotal?100*t.pIn/t.pTotal:null,visual:t.vTotal?100*(t.vTotal-t.vOut)/t.vTotal:null};
    }
    const sort=(m)=>[...m.entries()].filter(([,v])=>v>0).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'id'));
    // Komposisi Out-Spec Physical: level overall (Diameter vs Berat),
    // dilanjutkan rincian Diameter ME/BE. Semua tetap dari histori Quality yang sama.
    const diameterParts=['ME Mapak','ME Merit','BE Mekar','BE Mingkup','Diameter lainnya'];
    const diameterCount=diameterParts.reduce((sum,k)=>sum+(physCounts.get(k)||0),0);
    q.physicalOverview=[{name:'Diameter',count:diameterCount},{name:'Berat Rokok',count:physCounts.get('Berat rokok')||0}];
    q.diameterBreakdown=diameterParts.map(k=>({name:k==='Diameter lainnya'?'Lainnya':k,count:physCounts.get(k)||0}));
    q.physical=sort(physCounts);q.visual=sort(visCounts);
    return q;
  }
  // A4 PDF renderer, with original locked navy/cyan/teal template positions.
  const pdfFont=(p,size=9,bold=false)=>{p.setFont('helvetica',bold?'bold':'normal');p.setFontSize(size)};
  function rgb(h){const t=COLORS[h]||h;return [parseInt(t.slice(1,3),16),parseInt(t.slice(3,5),16),parseInt(t.slice(5,7),16)];}
  function rect(p,x,y,w,h,c='white',stroke=null,r=0){
    p.setFillColor(...rgb(c));if(stroke){p.setDrawColor(...rgb(stroke));p.setLineWidth(.7)}
    if(r)p.roundedRect(x,y,w,h,r,r,stroke?'FD':'F');else p.rect(x,y,w,h,stroke?'FD':'F');
  }
  function text(p,x,y,str,size=9,c='ink',bold=false,align='left',maxWidth){
    let value=String(str??'-');pdfFont(p,size,bold);p.setTextColor(...rgb(c));
    if(maxWidth)while(value.length>2&&p.getTextWidth(value)>maxWidth)value=value.slice(0,-2)+'…';
    p.text(value,x,y,{align});
  }
  function line(p,x,y,x2,y2,c='line',w=.7){p.setDrawColor(...rgb(c));p.setLineWidth(w);p.line(x,y,x2,y2)}
  function dot(p,x,y,c='teal'){p.setFillColor(...rgb(c));p.circle(x,y,2.7,'F')}
  function header(p,report){
    rect(p,0,0,595.28,4,'navy');
    try{p.addImage(REPORT_LOGO,'PNG',31,32,48,28)}catch(e){console.warn('Logo PDF tidak dapat dibaca',e)}
    text(p,88,40,'PT NIKORAMA CITRA TOBACCO',12,'navy',true);
    text(p,88,56,'LAPORAN OPERASIONAL PRODUKSI SKT',19,'navy',true);
    line(p,31,68,563,68);rect(p,31,81,532,6,'cyan');
    rect(p,31,100,88,56,'pale',null,8);rect(p,31,100,3,56,'teal');
    text(p,43,119,'LAPORAN',7.7,'mute',true);text(p,43,141,report.kind,11.2,'navy',true, 'left',74);
    rect(p,127,100,211,56,'white','line',8);
    text(p,141,116,'PERIODE LAPORAN',7,'mute',true);
    line(p,141,124,324,124);line(p,246,124,246,145);
    text(p,141,143,report.range,8.5,'navy',true,'left',100);
    text(p,292,143,report.tag,9,'navy',true,'center',81);
    rect(p,346,100,89,56,'white','line',8);
    text(p,357,116,'BRAND',7,'mute',true);line(p,357,124,424,124);
    text(p,357,143,brand||'SEMUA BRAND',8.1,'navy',true,'left',65);
    rect(p,443,100,120,56,'white','line',8);
    text(p,453,116,'SUMBER',7,'mute',true);line(p,453,124,553,124);
    text(p,453,143,'DASHBOARD ONE FOR ALL',7.5,'navy',true);
  }
  function section(p,no,label,y){dot(p,35,y-4);text(p,47,y,`${no} / ${label}`,10.1,'navy',true)}
  function footer(p,page){line(p,31,812,563,812);text(p,563,828,`${String(page).padStart(2,'0')} / 02`,8,'mute',true,'right')}
  function cards(p,s){
    const main=[['PEMAKAIAN TEMBAKAU',`${fmt(s.use,2)} Kg`,'blue'],['PEMAKAIAN KRITIK',`${fmt(s.kritik,2)} Kg`,'cyan'],['PRODUKSI AKTUAL',`${fmt(s.actual)} btg`,'navy'],['RATA-RATA BERAT ROKOK',s.weight===null?'-':`${fmt(s.weight,2)} g/btg`,'teal']];
    main.forEach(([lab,value,acc],i)=>{
      const x=31+i*135;rect(p,x,188,127,65,'white','line',8);rect(p,x+12,199,26,3,acc);
      text(p,x+12,215,lab,6.5,'mute',true,'left',111);
      text(p,x+12,240,value,i===2?12.1:13.5,'navy',true,'left',110);
    });
    const minor=[['WASTE TEMBAKAU',`${fmt(s.waste,2)} Kg`,'blue'],['WASTE SAPON',`${fmt(s.sapon,2)} Kg`,'cyan'],['WASTE GAGANG',`${fmt(s.gagang,2)} Kg`,'blue'],['YIELD PRODUKSI',s.yield===null?'-':`${fmt(s.yield,1)}%`,'teal'],['WASTE AMBRI',s.ambriPct===null?'-':`${fmt(s.ambriPct,2)}%`,'cyan']];
    minor.forEach(([lab,value,acc],i)=>{
      const x=31+i*107.5;rect(p,x,261,102,46,'light',null,6);rect(p,x+9,270,3,28,acc);
      text(p,x+18,280,lab,6.3,'mute',true,'left',81);
      text(p,x+18,297,value,11.5,'navy',true,'left',81);
    });
  }
  function trend(p,top,title,points,typ,period){
    const quarter=period.mode==='quarterly',height=quarter?109:91;
    rect(p,31,top,532,height,'light',null,9);dot(p,46,top+16);
    text(p,58,top+20,title,8.6,'navy',true);
    const valid=points.filter(g=>Number.isFinite(g.s[typ]));
    if(!valid.length){text(p,300,top+57,'Tidak ada data',10,'mute',false,'center');return}
    const count=points.length;const width=462;
    const coords=points.map((g,i)=>({g,x:count===1?303:72+i*width/(count-1),v:g.s[typ]}));
    let values=valid.map(g=>g.s[typ]),lo=Math.min(...values),hi=Math.max(...values);
    const gap=Math.max(hi-lo,typ==='weight'?.15:.9);lo-=gap*.40;hi+=gap*.40;
    const pY=v=>top+(quarter?54:59)-(v-lo)/(hi-lo)*(quarter?17:19);
    line(p,72,top+(quarter?58:63),534,top+(quarter?58:63));
    p.setDrawColor(...rgb(typ==='yield'?'blue':'teal'));p.setLineWidth(1.8);
    let prior=null;
    coords.forEach(point=>{if(Number.isFinite(point.v)&&prior)p.line(prior.x,pY(prior.v),point.x,pY(point.v));prior=Number.isFinite(point.v)?point:null});
    coords.forEach((point,i)=>{
      if(Number.isFinite(point.v)){
        p.setFillColor(...rgb(typ==='yield'?'blue':'teal'));p.circle(point.x,pY(point.v),2.7,'F');
        const vl=typ==='yield'?fmt(point.v,1)+'%':fmt(point.v,2);
        // Dense quarterly / yearly graph gets compact labels with no fabricated points.
        text(p,point.x,top+(quarter?34:36),vl,quarter?5.4:count>8?6:6.6,'navy',true,'center');
      }
      text(p,point.x,top+(quarter?73:84),point.g.label,quarter?6.3:count>8?6.1:7,'navy',true,'center');
    });
    if(quarter){
      let cursor=0;const months=[];
      points.forEach((g,i)=>{const name=g.monthLabel||SHORT[Number(g.date.slice(5,7))-1];const last=months[months.length-1];if(last&&last.name===name)last.end=i;else months.push({name,start:i,end:i})});
      months.forEach(m=>{
        const x1=Math.max(55,coords[m.start].x-11),x2=Math.min(545,coords[m.end].x+11);
        line(p,x1,top+79,x2,top+79,'line');line(p,x1,top+79,x1,top+82);line(p,x2,top+79,x2,top+82);
        text(p,(coords[m.start].x+coords[m.end].x)/2,top+92,m.name,8,'mute',true,'center');
      });
      line(p,72,top+96,534,top+96);text(p,300,top+106,period.tag.split(' ')[0],8.4,'teal',true,'center');
    }
  }
  function productionTable(p,points,period){
    const q=period.mode==='quarterly';const top=q?575:546;
    const widths=[80,57,44,83,63,44,61,48,52];const xs=[31];widths.forEach(w=>xs.push(xs[xs.length-1]+w));
    const h=q?25:29;rect(p,31,top,532,h,'navy',null,6);
    const headers=[['PERIODE',''],['PAKAI TBK','Kg'],['KRITIK','Kg'],['AKTUAL','Btg'],['BERAT ROKOK','g/btg'],['YIELD','%'],['TOTAL WASTE','Kg'],['SAPON','Kg'],['GAGANG','Kg']];
    headers.forEach(([a,b],i)=>{const cx=(xs[i]+xs[i+1])/2;text(p,cx,top+(q?10:12),a,6.1,'white',true,'center');if(b)text(p,cx,top+(q?20:23),b,5.7,'#C1D4E1',false,'center')});
    // Keep the PDF to 2 A4 pages even when the quarter has 14 weeks.
    const maxH=785-(top+h)-23;const rowh=Math.min(points.length>8?13.2:25.3,maxH/Math.max(points.length,1));
    const vals=(s,label)=>[label,fmt(s.use,0),fmt(s.kritik,0),fmt(s.actual),s.weight===null?'-':fmt(s.weight,2),s.yield===null?'-':fmt(s.yield,1)+'%',fmt(s.waste,0),fmt(s.sapon,0),fmt(s.gagang,0)];
    points.forEach((g,j)=>{
      const y=top+h+j*rowh;rect(p,31,y,532,rowh,j%2?'white':'light');
      vals(g.s,g.label).forEach((value,i)=>{
        const tx=i===0?xs[i]+5:xs[i+1]-5;
        text(p,tx,y+Math.min(rowh-2,Math.max(8,rowh*.64)),value,q?6.4:points.length>8?6.7:7.5,i===5?'teal':'ink',i===5,i===0?'left':'right',widths[i]-8);
      });
    });
    const at=top+h+points.length*rowh;rect(p,31,at,532,20,'pale');
    const sums=stats(points.flatMap(g=>g.rows));
    vals(sums,'TOTAL').forEach((value,i)=>text(p,i===0?xs[i]+5:xs[i+1]-5,at+13,value,7.3,i===5?'teal':'navy',true,i===0?'left':'right',widths[i]-8));
  }
  function pageProduction(p,period,selected,groupsList){
    header(p,period);section(p,'01','RINGKASAN PRODUKSI',175);cards(p,stats(selected));section(p,'02','GRAFIK TREN PRODUKSI',324);
    if(period.mode==='quarterly'){
      trend(p,330,'TREND % YIELD',groupsList,'yield',period);trend(p,441,'TREND BERAT ROKOK (G/BTG)',groupsList,'weight',period);
      section(p,'03','REKAP PRODUKSI PER PERIODE',563);
    }else{
      trend(p,336,'TREND % YIELD',groupsList,'yield',period);trend(p,433,'TREND BERAT ROKOK (G/BTG)',groupsList,'weight',period);
      section(p,'03','REKAP PRODUKSI PER PERIODE',538);
    }
    productionTable(p,groupsList,period);footer(p,1);
  }
  function pair(p,top,title,items,large=true){
    rect(p,31,top,532,large?86:76,'white','line',9);dot(p,46,top+18);text(p,58,top+22,title,9,'navy',true);
    items.forEach(([lab,value],i)=>{
      const x=43+i*257,ht=large?51:41,y=top+30;
      rect(p,x,y,250,ht,'light',null,7);rect(p,x+11,y+10,3,ht-19,i?'teal':'blue');
      text(p,x+23,y+19,lab,7,'mute',true,'left',215);
      text(p,x+23,y+(large?43:35),value,large?17:15,'navy',true);
    });
  }
  function inspection(p,x,q,who){
    const top=402,w=259;rect(p,x,top,w,142,'light',null,9);rect(p,x+11,top+11,34,22,'navy',null,6);
    text(p,x+28,top+27,who,10,'white',true,'center');text(p,x+w-78,top+26,'INSPEC',7.2,'teal',true,'right');text(p,x+w-13,top+26,'OUTSPEC',7.2,'pink',true,'right');
    ['physical','visual'].forEach((name,j)=>{
      const t=top+52+j*52,good=q&&q[name];
      text(p,x+13,t,name.toUpperCase(),8.6,'navy',true);
      text(p,x+w-78,t,good===null||good===undefined?'-':fmt(good,1)+'%',8,'teal',true,'right');
      text(p,x+w-13,t,good===null||good===undefined?'-':fmt(100-good,1)+'%',8,'pink',true,'right');
      rect(p,x+13,t+12,w-26,10,'palePink',null,3);
      if(good!==null&&good!==undefined&&good>0)rect(p,x+13,t+12,(w-26)*Math.max(0,Math.min(100,good))/100,10,'teal',null,3);
    });
  }
  function ranking(p,x,items,title,accent){
    const top=583,w=259;rect(p,x,top,w,170,'light',null,9);dot(p,x+16,top+16,accent);text(p,x+27,top+21,title,9,'navy',true);
    const shown=items.slice(0,5),rest=items.slice(5),otherCount=rest.reduce((a,r)=>a+r.count,0),all=shown.concat(otherCount?[{name:'Lainnya',count:otherCount}]:[]);
    const total=items.reduce((a,r)=>a+r.count,0);
    if(!total){text(p,x+13,top+78,'Tidak ada data Out-Spec',9,'mute');return}
    const max=Math.max(...all.map(r=>r.count));
    all.forEach((r,j)=>{
      const y=top+40+j*20.3,pct=100*r.count/total;
      text(p,x+13,y,r.name,7.8,j===0?'navy':'ink',j===0,'left',179);
      text(p,x+w-13,y,fmt(pct,1)+'%',8.1,accent,true,'right');
      rect(p,x+13,y+6,w-26,5,'line',null,2.5);rect(p,x+13,y+6,(w-26)*r.count/max,5,accent,null,2.5);
    });
  }
  // Diagram berjenjang Physical: dua total utama dan rinciannya menurut ME/BE.
  // Overall = bagian dari total outspec Physical; detail = bagian dari total outspec Diameter.
  function rankingPhysical(p,x,q){
    const top=583,w=259;
    rect(p,x,top,w,194,'light',null,9);dot(p,x+16,top+16,'blue');
    text(p,x+27,top+21,'PHYSICAL / OVERALL',9,'navy',true);
    const overview=q.physicalOverview||[],breakdown=q.diameterBreakdown||[];
    const overallTotal=overview.reduce((sum,r)=>sum+r.count,0);
    const diameterTotal=breakdown.reduce((sum,r)=>sum+r.count,0);
    if(!overallTotal){text(p,x+13,top+82,'Tidak ada data Out-Spec',9,'mute');return;}
    const bar=(name,pct,y,accent)=>{
      text(p,x+13,y,name,7.65,'ink',false,'left',158);
      text(p,x+w-13,y,fmt(pct,1)+'%',8.0,accent,true,'right');
      rect(p,x+13,y+5,w-26,4,'line',null,2);
      if(pct>0)rect(p,x+13,y+5,(w-26)*pct/100,4,accent,null,2);
    };
    overview.forEach((r,i)=>bar(r.name,100*r.count/overallTotal,top+39+i*21,i?'teal':'blue'));
    line(p,x+13,top+81,x+w-13,top+81,'line');
    text(p,x+13,top+92,'DETAIL DIAMETER / ME - BE',7.7,'navy',true);
    if(!diameterTotal){text(p,x+13,top+124,'Tidak ada Out-Spec Diameter',8,'mute');return;}
    const visible=breakdown.filter(r=>r.name!=='Lainnya'||r.count>0);
    visible.forEach((r,i)=>bar(r.name,100*r.count/diameterTotal,top+105+i*17,'blue'));
  }
  function pageQuality(p,period,q){
    header(p,period);section(p,'04','RINGKASAN QUALITY',175);
    pair(p,191,'INCOMING TEMBAKAU',[
      ['RATA-RATA MC DARI BLENDING',q.mcSend===null?'-':fmt(q.mcSend,2)+'%'],
      ['RATA-RATA MC TERIMA DI BRAK',q.mcReceive===null?'-':fmt(q.mcReceive,2)+'%']]);
    pair(p,284,'BERAT ROKOK SAMPLING GILING & GUNTING',[
      ['SAMPLING MK',q.samples.MK===null?'-':fmt(q.samples.MK,2)+' g'],
      ['SAMPLING SA',q.samples.SA===null?'-':fmt(q.samples.SA,2)+' g']],false);
    section(p,'05','INSPEKSI PHYSICAL & VISUAL',385);
    inspection(p,31,q.inspect.MK,'MK');inspection(p,304,q.inspect.SA,'SA');
    section(p,'06','PENYUMBANG OUTSPEC',565);
    rankingPhysical(p,31,q);ranking(p,304,q.visual,'VISUAL / TOP 5','teal');footer(p,2);
  }
  async function download(){
    const button=$('rptDownloadBtn');if(button)button.disabled=true;setStatus('Mengambil data terbaru dan membuat PDF A4...');
    try{
      if(window.NCTSupabase?.prepareSharedState&&window.NCT_USER_CONTEXT){
        try{await window.NCTSupabase.prepareSharedState(window.NCT_USER_CONTEXT)}catch(err){console.warn('Refresh laporan tidak berhasil, memakai data tersimpan.',err)}
      }
      refreshOptions();
      const {period,selected,quality,incoming}=cachedSummary;
      if(!period||!selected.length)throw new Error('Tidak ada Produksi Aktual pada periode yang dipilih. PDF tidak dibuat.');
      if(!window.jspdf?.jsPDF)throw new Error('Library PDF belum tersedia. Periksa koneksi internet lalu muat ulang dashboard.');
      const pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true});
      const pts=groups(selected,period);
      pageProduction(pdf,period,selected,pts);
      pdf.addPage();pageQuality(pdf,period,qualityStats(quality.filter(r=>r&&r.demo!==true),incoming));
      const safe=s=>String(s).replace(/[^A-Za-z0-9_-]+/g,'_');
      const file=`Laporan_Produksi_SKT_${safe(period.kind)}_${safe(period.tag)}_${period.start}_${period.end}${brand?'_'+safe(brand):''}.pdf`;
      pdf.save(file);
      setStatus(`PDF A4 berhasil dibuat: ${file}`);
    }catch(err){console.error('Laporan Produksi SKT:',err);setStatus(err.message||'Gagal membuat PDF.',true)}
    finally{refreshOptions();}
  }
  function init(){
    document.querySelectorAll('[data-report-mode]').forEach(b=>b.addEventListener('click',()=>{mode=b.dataset.reportMode;refreshOptions();setStatus('')}));
    $('rptYear')?.addEventListener('change',e=>{year=e.target.value;selectedWeek='';selectedMonth='';refreshOptions();setStatus('')});
    $('rptBrand')?.addEventListener('change',e=>{brand=e.target.value;selectedWeek='';selectedMonth='';refreshOptions();setStatus('')});
    $('rptWeek')?.addEventListener('change',e=>{selectedWeek=e.target.value;refreshOptions();setStatus('')});
    $('rptMonth')?.addEventListener('change',e=>{selectedMonth=e.target.value;refreshOptions();setStatus('')});
    $('rptQuarter')?.addEventListener('change',e=>{selectedQuarter=e.target.value;refreshOptions();setStatus('')});
    $('rptDownloadBtn')?.addEventListener('click',download);
    refreshOptions();
  }
  const REPORT_LOGO='data:image/png;base64,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';
  window.NCTProductionReport={refresh:refreshOptions,download,previewData:()=>{
    refreshOptions();return {period:cachedSummary.period,records:cachedSummary.selected,groups:cachedSummary.period?groups(cachedSummary.selected,cachedSummary.period):[]};
  }};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
