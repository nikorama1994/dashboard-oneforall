(function(){
  'use strict';

  let channel=null;
  let onlineUsers=[];
  let lockNoticeAt=0;

  function normalizeRole(role){
    role=String(role||'guest_internal').toLowerCase();
    return role==='viewer'?'guest_internal':role;
  }

  function roleLabel(role){
    role=normalizeRole(role);
    return ({
      admin:'Admin',
      qc_inspector:'QC Inspector',
      guest_internal:'Guest Internal',
      guest_external:'Guest Eksternal'
    })[role]||role;
  }

  function isOnline(id){
    id=String(id||'');
    return onlineUsers.some(function(u){return String(u.user_id||'')===id});
  }

  function publish(){
    window.NCTPresence={
      isOnline:isOnline,
      getOnlineUsers:function(){return onlineUsers.slice();}
    };

    document.dispatchEvent(new CustomEvent('nct-presence-update',{
      detail:{users:onlineUsers.slice(),onlineIds:onlineUsers.map(function(u){return u.user_id;})}
    }));

    const badge=document.getElementById('nctOnlineBadge');
    if(badge){
      badge.textContent='ONLINE '+onlineUsers.length;
      badge.title=onlineUsers.length
        ? onlineUsers.map(function(u){return (u.name||u.username||'User')+' · '+roleLabel(u.role)}).join('\n')
        : 'Tidak ada user online';
    }

    const writers=onlineUsers.filter(function(u){
      const r=normalizeRole(u.role);
      return r==='admin'||r==='qc_inspector';
    });

    let notice=document.getElementById('nctWriterNotice');
    if(writers.length>1){
      if(!notice){
        notice=document.createElement('div');
        notice.id='nctWriterNotice';
        notice.className='nctWriterNotice';
        document.body.appendChild(notice);
      }
      notice.textContent=writers.length+' editor sedang online. Sebelum mengedit, klik SYNC agar memakai data terbaru dan hindari menyimpan perubahan pada waktu yang sama.';
    }else if(notice){
      notice.remove();
    }
  }

  function flattenPresence(state){
    const out=[];
    Object.keys(state||{}).forEach(function(key){
      const entries=Array.isArray(state[key])?state[key]:[];
      entries.forEach(function(entry){
        const u={
          user_id:String(entry.user_id||key||''),
          username:String(entry.username||''),
          name:String(entry.name||entry.username||''),
          role:normalizeRole(entry.role),
          online_at:String(entry.online_at||'')
        };
        if(u.user_id)out.push(u);
      });
    });

    const unique=new Map();
    out.forEach(function(u){unique.set(u.user_id,u)});
    return Array.from(unique.values()).sort(function(a,b){
      return String(a.name||a.username).localeCompare(String(b.name||b.username),'id');
    });
  }

  function addTopbarBadge(){
    const userBox=document.getElementById('userBox');
    if(!userBox || document.getElementById('nctOnlineBadge'))return;
    const el=document.createElement('span');
    el.id='nctOnlineBadge';
    el.className='nctOnlineBadge';
    el.textContent='ONLINE 1';
    const logout=document.getElementById('logoutBtn');
    if(logout)userBox.insertBefore(el,logout);
    else userBox.appendChild(el);
  }

  function lockedMessage(message){
    const now=Date.now();
    if(now-lockNoticeAt<800)return;
    lockNoticeAt=now;
    alert(message);
  }

  function applyQcLocks(){
    if(!document.body.classList.contains('role-qc-inspector'))return;
    ['sideDatabase','sideSettings'].forEach(function(id){
      const el=document.getElementById(id);
      if(el){
        el.setAttribute('aria-disabled','true');
        el.dataset.roleLocked='qc';
        el.title=id==='sideDatabase'
          ? 'Database hanya dapat diakses Admin'
          : 'Pengaturan hanya dapat diakses Admin';
      }
    });
  }

  function installLockedMenuGuard(){
    document.addEventListener('click',function(e){
      if(!document.body.classList.contains('role-qc-inspector'))return;
      const el=e.target && e.target.closest ? e.target.closest('#sideDatabase,#sideSettings') : null;
      if(!el)return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      lockedMessage(el.id==='sideDatabase'
        ? 'Menu Database terkunci untuk QC Inspector.'
        : 'Menu Pengaturan terkunci untuk QC Inspector.');
    },true);

    const original=window.showPage;
    if(typeof original==='function'){
      window.showPage=function(id){
        if(document.body.classList.contains('role-qc-inspector') && (id==='database'||id==='settings')){
          lockedMessage(id==='database'
            ? 'Menu Database terkunci untuk QC Inspector.'
            : 'Menu Pengaturan terkunci untuk QC Inspector.');
          return original('dashboard');
        }
        return original.apply(this,arguments);
      };
    }
  }

  async function startPresence(context){
    if(!context || !window.NCTSupabase || !window.NCTSupabase.client)return;

    const p=context.profile||{};
    const u=context.user||{};
    const userId=String(p.id||u.id||'');
    if(!userId)return;

    addTopbarBadge();
    applyQcLocks();
    installLockedMenuGuard();

    try{
      const sb=window.NCTSupabase.client;
      channel=sb.channel('dashboard-presence-v1',{
        config:{presence:{key:userId}}
      });

      channel.on('presence',{event:'sync'},function(){
        onlineUsers=flattenPresence(channel.presenceState());
        publish();
      });

      channel.on('presence',{event:'join'},function(){
        onlineUsers=flattenPresence(channel.presenceState());
        publish();
      });

      channel.on('presence',{event:'leave'},function(){
        onlineUsers=flattenPresence(channel.presenceState());
        publish();
      });

      channel.subscribe(async function(status){
        if(status==='SUBSCRIBED'){
          await channel.track({
            user_id:userId,
            username:String(p.username||String(u.email||'user').split('@')[0]),
            name:String(p.name||p.username||String(u.email||'User').split('@')[0]),
            role:normalizeRole(p.role),
            online_at:new Date().toISOString()
          });
        }
      });

      const cleanup=function(){
        try{channel && channel.untrack()}catch(_){}
      };
      window.addEventListener('pagehide',cleanup,{once:true});
      window.addEventListener('beforeunload',cleanup,{once:true});
    }catch(err){
      console.warn('Presence gagal dimulai:',err);
      onlineUsers=[{
        user_id:userId,
        username:String(p.username||''),
        name:String(p.name||p.username||'User'),
        role:normalizeRole(p.role),
        online_at:new Date().toISOString()
      }];
      publish();
    }
  }

  function init(context){
    if(!context)return;
    startPresence(context);
  }

  if(window.NCT_USER_CONTEXT)init(window.NCT_USER_CONTEXT);
  else document.addEventListener('nct-auth-ready',function(e){init(e.detail);},{once:true});
})();
