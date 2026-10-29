import { visibleText, normalizeHandle, openPrivate, sendText, createProfile, compareMessages } from './data.js';


// Связь v5: веб-приложение с Firebase Authentication + Firestore.
// Конфигурация — настройки публичного веб-приложения Firebase, НЕ секрет администратора.
const firebaseConfig = {
  apiKey: "AIzaSyBYnHf2neYx641t5ykzcDIFbv2n3taegkM",
  authDomain: "svyaz-messenger-94939.firebaseapp.com",
  projectId: "svyaz-messenger-94939",
  storageBucket: "svyaz-messenger-94939.firebasestorage.app",
  messagingSenderId: "288093602142",
  appId: "1:288093602142:web:0466cb97e7c36196aa4fcf"
};
(function(){
'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let auth=null,db=null,authSDK=null,fs=null,readySdk=false;
let user=null,profile=null,profileCache=new Map(),chats=[],activeChat=null,selectedTab='chats',searchValue='';
let profileSubscriptions=new Map(),outbox=new Map(),drafts=new Map(),lastMessages=[],chatGeneration=0,searchRequest=0,chatsConfirmed=false;
let unsubChats=null,unsubMessages=null,authBusy=false,mode='login',userGeneration=0,createType='private',busyCreate=false;
const authTexts={login:['Вход в аккаунт','Войти'],register:['Создать аккаунт','Зарегистрироваться'],reset:['Восстановление пароля','Отправить письмо']};
const authErrors={
 'auth/email-already-in-use':'Этот email уже зарегистрирован. Попробуй войти.',
 'auth/invalid-email':'Проверь адрес электронной почты.',
 'auth/invalid-credential':'Неверный email или пароль.',
 'auth/weak-password':'Слишком простой пароль. Используй минимум 6 символов.',
 'auth/too-many-requests':'Слишком много попыток. Попробуй позже.',
 'auth/network-request-failed':'Нет соединения с Firebase.',
 'auth/operation-not-allowed':'В Firebase не включён Email/Password.',
 'auth/unauthorized-domain':'Добавь домен сайта в Firebase Authentication → Authorized domains.'
};
function explain(err){
 if(!err)return 'Неизвестная ошибка.';
 if(authErrors[err.code])return authErrors[err.code];
 if(err.code==='permission-denied')return 'Нет доступа к Firestore. Проверь, что вставлены и опубликованы правила из файла firestore.rules.';
 if(err.code==='failed-precondition')return 'Не выполнены требования Firestore: проверь создание базы (default) и необходимые индексы.';
 if(err.code==='unavailable')return 'Firestore недоступен. Проверь интернет.';
 return err.message||String(err);
}
function notice(t){document.querySelector('.notice')?.remove();const x=document.createElement('div');x.className='notice';x.textContent=t;document.body.appendChild(x);setTimeout(()=>x.remove(),3400)}
function authMessage(t,good=false){$('authMessage').textContent=t;$('authMessage').className=good?'authGood':'authError'}
function switchAuth(next){mode=next;$('authHeading').textContent=authTexts[next][0];$('authSubmit').textContent=authTexts[next][1];$('authDescription').textContent=next==='login'?'Войди по email, чтобы открыть свой мессенджер.':next==='register'?'Создай аккаунт и переписывайся с людьми.':'Введи email, чтобы сбросить пароль.';
 $('authNameWrap').hidden=next!=='register';$('authConfirmWrap').hidden=next!=='register';$('authPasswordWrap').hidden=next==='reset';$('authPassword').required=next!=='reset';$('authConfirm').required=next==='register';$('authPassword').autocomplete=next==='register'?'new-password':'current-password';$('authForgot').hidden=next==='reset';$('authSwitch').textContent=next==='login'?'Создать аккаунт':'Уже есть аккаунт? Войти';authMessage('');}
$('authSwitch').onclick=()=>switchAuth(mode==='login'?'register':'login');$('authForgot').onclick=()=>switchAuth('reset');switchAuth('login');
function showAuth(){ $('authGate').hidden=false;$('profileGate').hidden=true; $('app').style.visibility='hidden'; $('authSubmit').disabled=!readySdk; }
function showOnboarding(){ $('profileForm').hidden=false;$('retryProfile').hidden=true; $('authGate').hidden=true;$('profileGate').hidden=false;$('app').style.visibility='hidden';$('onboardNotice').textContent='';$('profileDisplayName').value=auth?.currentUser?.displayName||''; }
function showApplication(){ $('authGate').hidden=true;$('profileGate').hidden=true;$('app').style.visibility='visible';renderList(); }
function current(token,uid){return token===userGeneration && user?.uid===uid && auth?.currentUser?.uid===uid;}
function renderLiveList(){if(selectedTab!=='contacts')renderList();}
$('retryProfile').onclick=()=>loadSession(auth?.currentUser);
function cleanupListeners(){ profileSubscriptions.forEach(stop=>stop());profileSubscriptions.clear(); if(unsubChats){unsubChats();unsubChats=null;} if(unsubMessages){unsubMessages();unsubMessages=null;} }
function closeConversation(){
 if(activeChat)drafts.set(activeChat,$('msgInput').value);
 ++chatGeneration;if(unsubMessages){unsubMessages();unsubMessages=null;}
 activeChat=null;lastMessages=[];$('messages').replaceChildren();$('msgInput').value='';$('convName').textContent='';$('convStatus').textContent='';$('convAvatar').textContent='';
 $('app').classList.remove('inchat');$('conversation').classList.remove('active');$('welcome').style.display='block';
}
async function loadSession(nextUser){
 const token=++userGeneration;
 if(history.state?.svyazChat)history.replaceState(null,'');
 cleanupListeners();closeConversation();chats=[];profileCache.clear();drafts.clear();outbox.clear();lastMessages=[];chatsConfirmed=false;profile=null;user=nextUser;++searchRequest;
 $('msgInput').value='';$('authPassword').value='';$('authConfirm').value='';$('newName').value='';$('groupMembers').value='';$('profileHandle').value='';$('profileDisplayName').value='';closeModal();$('list').replaceChildren();
 selectedTab='chats';searchValue='';$('search').value='';
 if(!user){showAuth();renderList();return;}
 // Authenticated users may not have chosen their public @name yet.
 $('authGate').hidden=false;authMessage('Загружаем профиль…',true);
 try {
  const snap=await fs.getDoc(fs.doc(db,'users',user.uid));
  if(!current(token,nextUser.uid))return;
  if(!snap.exists()){showOnboarding();return;}
  profile=snap.data();profileCache.set(user.uid,profile);
  showApplication();subscribeChats();watchProfile(user.uid,userGeneration,user.uid);
 }catch(err){if(!current(token,nextUser.uid))return;showOnboarding();$('profileForm').hidden=true;$('retryProfile').hidden=false;$('onboardNotice').textContent='Не удалось загрузить профиль: '+explain(err);}
}
$('authForm').onsubmit=async e=>{
 e.preventDefault();if(authBusy)return;
 if(!readySdk){authMessage('Firebase ещё загружается. Проверь интернет и попробуй открыть сайт через HTTPS.');return;}
 const email=$('authEmail').value.trim(),password=$('authPassword').value;
 if(mode==='register' && password!==$('authConfirm').value){authMessage('Пароли не совпадают.');return;}
 authBusy=true;$('authSubmit').disabled=true;authMessage('');
 try{
  if(mode==='reset'){await authSDK.sendPasswordResetEmail(auth,email);authMessage('Если для адреса доступно восстановление, письмо отправлено. Проверь почту.',true);}
  else if(mode==='register'){
   const cred=await authSDK.createUserWithEmailAndPassword(auth,email,password);
   const name=$('authName').value.trim();
   if(name){try{await authSDK.updateProfile(cred.user,{displayName:name})}catch(e){console.warn(e)}}
   try{await authSDK.sendEmailVerification(cred.user)}catch(e){console.warn('Email verification',e)}
   await loadSession(cred.user);
  } else {const cred=await authSDK.signInWithEmailAndPassword(auth,email,password); await loadSession(cred.user);}
 }catch(err){authMessage(explain(err));if(auth?.currentUser?.uid!==user?.uid)await loadSession(auth.currentUser);}finally{authBusy=false;$('authPassword').value='';$('authConfirm').value='';$('authSubmit').disabled=false;}
};
async function signOut(){if(!auth)return;if(!confirm('Выйти из аккаунта? Неотправленные сообщения в памяти будут потеряны.'))return;try{await authSDK.signOut(auth);await loadSession(null);}catch(err){notice(explain(err))}}
// ----- Public usernames, linked atomically to a private Auth UID -----
$('profileForm').onsubmit=async e=>{
 e.preventDefault();if(!user||!fs)return;
 const handle=$('profileHandle').value.trim().toLowerCase().replace(/^@/,'');const displayName=$('profileDisplayName').value.trim();
 if(!/^[a-z0-9_]{3,20}$/.test(handle)){$('onboardNotice').textContent='Имя @ должно быть 3–20 символов: латинские буквы, цифры, подчёркивание.';return;}
 if(displayName.length<1||displayName.length>45){$('onboardNotice').textContent='Введи отображаемое имя длиной до 45 символов.';return;}
 $('onboardSubmit').disabled=true;$('onboardNotice').textContent='Сохраняем профиль…';
 try{
  await createProfile(fs,db,uid,displayName,handle);
  if(!current(token,uid))return;
  profile={handle,displayName};profileCache.set(user.uid,profile);
  $('profileGate').hidden=true;showApplication();subscribeChats();watchProfile(uid,token,uid);notice('Твоё имя @'+handle+' создано');
 }catch(err){if(!current(token,uid))return;$('retryProfile').hidden=false;$('onboardNotice').textContent='Не удалось создать имя. Возможно, оно уже занято, либо не опубликованы правила Firestore. '+explain(err)}finally{if(current(token,uid))$('onboardSubmit').disabled=false;}
};
async function findHandle(raw){
 const name=normalizeHandle(raw),token=userGeneration,uid=user?.uid;
 if(!/^[a-z0-9_]{3,20}$/.test(name))throw Error('Укажи точное @имя: 3–20 символов, латиница, цифры или _.');
 const mapping=await fs.getDocFromServer(fs.doc(db,'handles',name));
 if(!current(token,uid))throw Error('Сессия изменилась.');
 if(!mapping.exists())throw Error('Пользователь @'+name+' не найден.');
 const peer=mapping.data().uid;
 const snap=await fs.getDocFromServer(fs.doc(db,'users',peer));
 if(!current(token,uid))throw Error('Сессия изменилась.');
 if(!snap.exists()||snap.data().handle!==name)throw Error('Никнейм изменился. Повторите поиск.');
 return {uid:peer,...snap.data()};
}
function watchProfile(peer,token,uid){
 if(profileSubscriptions.has(peer))return;
 profileSubscriptions.set(peer,fs.onSnapshot(fs.doc(db,'users',peer),snap=>{
  if(!current(token,uid)||snap.metadata.isFromCache)return;
  if(snap.exists()){
   profileCache.set(peer,snap.data());if(peer===uid)profile=snap.data();
  }else{profileCache.delete(peer);}
  renderLiveList();if(activeChat){updateChatHeader();renderMessages(lastMessages);}
 },()=>{if(current(token,uid)){profileCache.delete(peer);renderLiveList();}}));
}
function chatName(c){if(c.type==='group')return c.title||'Группа'; const other=c.members.find(uid=>uid!==user?.uid);const p=profileCache.get(other);return p?.displayName || (other?'Пользователь '+other.slice(0,5):'Личный чат');}
function chatSub(c){if(c.type==='group')return 'Группа · '+c.members.length+' участников';const other=c.members.find(uid=>uid!==user?.uid);const p=profileCache.get(other);return p?'@'+p.handle:'Личный чат';}
function dateText(ts){if(!ts||!ts.toDate)return '';const d=ts.toDate();return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
function sortedChats(){return [...chats].sort((a,b)=>(b.updatedAt?.toMillis?.()||0)-(a.updatedAt?.toMillis?.()||0));}
function renderList(){
 const titles={chats:'СООБЩЕНИЯ',groups:'ТВОИ ГРУППЫ',contacts:'ПОИСК ЛЮДЕЙ',settings:'ТВОЙ ПРОФИЛЬ'};
 $('sectionTitle').textContent=titles[selectedTab];
 document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active',b.dataset.tab===selectedTab));
 $('searchWrap').style.display=['chats','groups'].includes(selectedTab)?'flex':'none';
 $('newBtn').style.display=['chats','groups'].includes(selectedTab)?'block':'none';
 if(selectedTab==='settings'){
  $('list').innerHTML=`<div class="profile"><div class="profilehero"><div class="avatar green">${escapeHtml((profile?.displayName||'Я')[0].toUpperCase())}</div><h2>${escapeHtml(profile?.displayName||'Профиль')}</h2><p>@${escapeHtml(profile?.handle||'')}</p><p>${escapeHtml(auth?.currentUser?.email||'')}</p></div><button class="setting" id="themeSetting"><span>☾ &nbsp; Тема оформления<small>Светлая или тёмная</small></span><span class="pill">${document.body.classList.contains('light')?'Светлая':'Тёмная'}</span></button><button class="setting" id="renameSetting"><span>✎ &nbsp; Изменить имя<small>@имя останется прежним</small></span><span>›</span></button><button class="setting important" id="logoutSetting"><span>↪ &nbsp; Выйти из аккаунта<small>Потребуется войти по email</small></span><span>›</span></button><p class="contentNote">Сообщения Firestore хранятся в облаке и доступны участникам чата. Сквозное шифрование не используется.</p></div>`;
  $('themeSetting').onclick=toggleTheme;$('logoutSetting').onclick=signOut;$('renameSetting').onclick=renameProfile;return;
 }
 if(selectedTab==='contacts'){
  $('list').innerHTML=`<div class="searchPerson"><label for="peopleInput">Найди человека по точному @имени (email не показывается)</label><input id="peopleInput" placeholder="Например, anna_12" autocomplete="off"><button id="findPersonBtn">Найти пользователя</button></div><div id="personResult" class="inlineStatus">Попроси друга назвать своё @имя после регистрации.</div>`;
  $('findPersonBtn').onclick=searchPerson;
  $('peopleInput').addEventListener('input',()=>{++searchRequest;$('personResult').replaceChildren();});
  $('peopleInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchPerson()});return;
 }
 const filtered=sortedChats().filter(c=>selectedTab==='groups'?c.type==='group':true).filter(c=>chatName(c).toLocaleLowerCase('ru').includes(searchValue.toLocaleLowerCase('ru')));
 $('list').innerHTML=filtered.length?filtered.map(c=>`<button class="chatrow ${activeChat===c.id?'selected':''}" data-id="${escapeHtml(c.id)}"><div class="avatar ${c.type==='group'?'violet':'green'}">${escapeHtml(chatName(c).slice(0,1).toUpperCase())}</div><div class="chatmeta"><div class="chatline"><span class="chatname">${escapeHtml(chatName(c))}</span><span class="chatdate">${escapeHtml(dateText(c.updatedAt))}</span></div><div class="preview">${escapeHtml(visibleText(c.lastText||chatSub(c)))}</div></div></button>`).join(''):'<div class="emptySide">Здесь пока нет переписок.<br>Найди человека во вкладке «Люди» или нажми «+».</div>';
 document.querySelectorAll('.chatrow').forEach(b=>b.onclick=()=>openChat(b.dataset.id));
}
function applyTheme(){const light=localStorage.getItem('svyaz_v5_theme')==='light';document.body.classList.toggle('light',light);$('themeQuick').textContent=light?'☀':'☾';document.querySelector('meta[name="theme-color"]').content=light?'#fff':'#0c1422';}
function toggleTheme(){localStorage.setItem('svyaz_v5_theme',document.body.classList.contains('light')?'dark':'light');applyTheme();renderList();}
async function renameProfile(){
 if(!profile||!user)return;const uid=user.uid,token=userGeneration;
 const name=prompt('Новое отображаемое имя:',profile.displayName);if(name===null)return;const v=name.trim();
 if(!v||v.length>45){notice('Имя должно быть длиной от 1 до 45 символов');return;}
 try{await fs.updateDoc(fs.doc(db,'users',uid),{displayName:v});if(current(token,uid))notice('Имя обновлено');}
 catch(err){if(current(token,uid))notice(explain(err));}
}
async function searchPerson(){
 const value=$('peopleInput').value,out=$('personResult'),token=userGeneration,uid=user?.uid,request=++searchRequest;
 out.className='inlineStatus';out.textContent='Ищем…';
 try{const p=await findHandle(value);if(!current(token,uid)||request!==searchRequest||!out.isConnected)return;
  if(p.uid===uid){out.textContent='Это твой собственный профиль.';return;}
  out.innerHTML=`<div class="searchResult"><strong>${escapeHtml(p.displayName)}</strong><div class="handle">@${escapeHtml(p.handle)}</div><button class="personButton" id="personChat">Начать личную переписку</button></div>`;
  $('personChat').onclick=async()=>{try{await createPrivate(p)}catch(e){if(current(token,uid))notice(explain(e))}};
 }catch(err){if(current(token,uid)&&request===searchRequest&&out.isConnected){out.textContent=explain(err);out.className='inlineStatus statusError';}}
}
function subscribeChats(){
 if(!user)return;if(unsubChats)unsubChats();const uid=user.uid,token=userGeneration;
 const q=fs.query(fs.collection(db,'chats'),fs.where('members','array-contains',uid));
 unsubChats=fs.onSnapshot(q,{includeMetadataChanges:true},snap=>{
  if(!current(token,uid))return;if(snap.metadata.isFromCache&&!chatsConfirmed)return;
  if(!snap.metadata.isFromCache)chatsConfirmed=true;
  chats=snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>Array.isArray(c.members)&&c.members.includes(uid));
  if(activeChat&&!chats.some(c=>c.id===activeChat))closeConversation();
  const wanted=new Set([uid,...chats.flatMap(c=>c.members)]);
  for(const [peer,stop] of profileSubscriptions)if(!wanted.has(peer)){stop();profileSubscriptions.delete(peer);profileCache.delete(peer);}
  wanted.forEach(peer=>watchProfile(peer,token,uid));renderLiveList();if(activeChat)updateChatHeader();
 },err=>{if(!current(token,uid))return;chatsConfirmed=false;notice(explain(err));if(err.code==='permission-denied'){chats=[];closeConversation();renderLiveList();}});
}
async function createPrivate(person){
 if(!user||person.uid===user.uid)return;
 if(!chatsConfirmed)throw Error('Дождитесь загрузки чатов с сервера.');
 const uid=user.uid,token=userGeneration;
 const chat=await openPrivate(fs,db,uid,person.uid,chats);
 if(!current(token,uid))return;
 if(!chats.some(c=>c.id===chat.id))chats.push(chat);
 selectedTab='chats';searchValue='';$('search').value='';openChat(chat.id);
}
function openModal(t){createType=t;$('modalTitle').textContent=t==='group'?'Создать группу':'Начать личный чат';$('modalDesc').textContent=t==='group'?'Укажи название и @имена участников через запятую.':'Введи точное @имя человека, чтобы начать личную переписку.';$('newName').placeholder=t==='group'?'Название группы':'@имя пользователя';$('newName').value='';$('newName').maxLength=t==='group'?60:21;$('groupMembersWrap').hidden=t!=='group';$('groupMembers').value='';$('createError').textContent='';$('modalBack').classList.add('open');}
function closeModal(){$('modalBack').classList.remove('open')}
$('cancel').onclick=closeModal;$('modalBack').onclick=e=>{if(e.target===$('modalBack'))closeModal()};
$('createForm').onsubmit=async e=>{
 e.preventDefault();if(busyCreate)return;const uid=user?.uid,token=userGeneration;const name=$('newName').value.trim();const error=$('createError');busyCreate=true;error.textContent='';
 try{
  if(createType==='private'){const person=await findHandle(name);if(person.uid===user.uid)throw Error('Нельзя создать переписку с самим собой.');await createPrivate(person);}
  else{
   if(!name||name.length>60)throw Error('Введи название группы (до 60 символов).');
   const names=[...new Set($('groupMembers').value.split(/[,;\n]+/).map(v=>v.trim().toLowerCase().replace(/^@/,'')).filter(Boolean))];
   if(names.length<1||names.length>10)throw Error('Добавь от 1 до 10 людей по их @именам.');
   const members=[uid];
   for(const h of names){const p=await findHandle(h);if(!members.includes(p.uid))members.push(p.uid);}
   if(members.length<2)throw Error('Добавь хотя бы одного другого пользователя.');
   if(!current(token,uid))return;
   const ref=fs.doc(fs.collection(db,'chats'));
   await fs.setDoc(ref,{type:'group',title:name,members,owner:uid,createdAt:fs.serverTimestamp(),updatedAt:fs.serverTimestamp(),lastText:'',lastSenderId:'',lastMessageId:''});
   const s=await fs.getDocFromServer(ref);if(!current(token,uid))return;chats.push({id:ref.id,...s.data()});selectedTab='groups';openChat(ref.id);
  }
  if(current(token,uid)){closeModal();notice('Переписка создана');}
 }catch(err){if(current(token,uid))error.textContent=explain(err);}finally{busyCreate=false;}
};
$('newBtn').onclick=()=>openModal(selectedTab==='groups'?'group':'private');
document.querySelectorAll('.navbtn').forEach(b=>b.onclick=()=>{++searchRequest;closeConversation();selectedTab=b.dataset.tab;searchValue='';$('search').value='';renderList();});
$('search').oninput=()=>{searchValue=$('search').value;renderList();};$('themeQuick').onclick=toggleTheme;
function updateChatHeader(){const c=chats.find(x=>x.id===activeChat);if(!c)return;$('convName').textContent=chatName(c);$('convStatus').textContent=chatSub(c);$('convAvatar').textContent=chatName(c).slice(0,1).toUpperCase();}
function openChat(id){
 const c=chats.find(x=>x.id===id);if(!c||!user)return;
 if(window.innerWidth<=700&&!history.state?.svyazChat)history.pushState({svyazChat:true},'');
 closeConversation();activeChat=id;const chatToken=++chatGeneration,token=userGeneration,uid=user.uid;let confirmed=false;
 $('msgInput').value=drafts.get(id)||'';$('msgInput').dispatchEvent(new Event('input'));$('composer').querySelector('.send').disabled=false;
 $('app').classList.add('inchat');$('welcome').style.display='none';$('conversation').classList.add('active');$('convAvatar').className='avatar '+(c.type==='group'?'violet':'green');updateChatHeader();$('messages').innerHTML='<div class="inlineStatus">Загружаем сообщения…</div>';renderLiveList();
 const q=fs.query(fs.collection(db,'chats',id,'messages'),fs.orderBy('createdAt','asc'),fs.orderBy(fs.documentId(),'asc'),fs.limitToLast(100));
 unsubMessages=fs.onSnapshot(q,{includeMetadataChanges:true},snap=>{
  if(!current(token,uid)||chatToken!==chatGeneration||activeChat!==id)return;
  if(snap.metadata.isFromCache&&!confirmed)return;if(!snap.metadata.isFromCache)confirmed=true;
  lastMessages=snap.docs.map(d=>({id:d.id,...d.data(),pending:d.metadata.hasPendingWrites}));
  for(const m of lastMessages)if(!m.pending)outbox.delete(m.id);
  renderMessages(lastMessages);
 },err=>{
  if(!current(token,uid)||chatToken!==chatGeneration)return;
  if(err.code==='permission-denied'){lastMessages=[];$('messages').replaceChildren();}
  notice(explain(err));renderMessages(lastMessages);
 });
}
function renderMessages(messages){
 if(!activeChat)return;const area=$('messages'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<80;
 const outstanding=[...outbox.values()].filter(m=>m.chatId===activeChat&&!messages.some(x=>x.id===m.id));
 const rows=[...messages,...outstanding].sort(compareMessages);
 const previous=area.dataset.lastId,newest=rows.at(-1);const follow=nearBottom||!previous||(newest?.id!==previous&&newest?.senderId===user?.uid);
 const top=area.scrollTop;
 area.innerHTML='<div class="daylabel">Последние 100 сообщений</div>'+rows.map(m=>{
  const mine=m.senderId===user?.uid,p=profileCache.get(m.senderId),failed=m.status==='failed',pending=m.pending||m.status==='sending';
  const sender=mine?'':`<div class="sender">${escapeHtml(p?.displayName||(m.senderId?.slice(0,6)||'Участник'))}</div>`;
  return `<div class="msg ${mine?'mine':''}" data-message-id="${escapeHtml(m.id)}">${sender}${escapeHtml(visibleText(m.text))}<small>${escapeHtml(dateText(m.createdAt))}${failed?' · Не отправлено':pending?' · Отправляем…':mine?' ✓':''}</small>${failed?`<button type="button" class="action" data-retry="${escapeHtml(m.id)}">Повторить</button>`:''}</div>`;
 }).join('');
 area.dataset.lastId=newest?.id||'';area.scrollTop=follow?area.scrollHeight:top;
 area.querySelectorAll('[data-retry]').forEach(button=>button.onclick=()=>{const message=outbox.get(button.dataset.retry);if(message)transmit(message);});
}
$('back').onclick=()=>{if(history.state?.svyazChat)history.back();else{closeConversation();renderList();}};
window.addEventListener('popstate',()=>{closeConversation();renderList();});
$('infoBtn').onclick=()=>{const c=chats.find(x=>x.id===activeChat);if(c)notice(c.type==='group'?'Группа: '+c.members.length+' участников. Управление составом будет позже.':chatSub(c));};
async function transmit(message){
 const token=message.session,uid=message.senderId;if(!current(token,uid)||message.inFlight)return;
 message.inFlight=true;message.status='sending';outbox.set(message.id,message);
 if(!navigator.onLine){message.inFlight=false;message.status='failed';if(activeChat===message.chatId)renderMessages(lastMessages);notice('Нет соединения. Сообщение сохранено для повторной отправки.');return;}
 if(activeChat===message.chatId)renderMessages(lastMessages);
 try{
  await sendText(fs,db,uid,message.chatId,message);
  if(!current(token,uid))return;
  outbox.delete(message.id);
  // A committed transaction is server confirmation, even if its snapshot has not reached this view yet.
  if(activeChat===message.chatId&&!lastMessages.some(m=>m.id===message.id))lastMessages.push({...message,status:'sent',pending:false});
 }catch(err){
  if(!current(token,uid))return;
  if(outbox.has(message.id)){message.status='failed';notice('Не отправлено. Проверьте интернет и нажмите «Повторить».');}
 }finally{
  message.inFlight=false;
  if(current(token,uid)&&activeChat===message.chatId)renderMessages(lastMessages);
 }
}
$('composer').onsubmit=e=>{
 e.preventDefault();const input=$('msgInput'),text=input.value;
 if(!text.trim()||!activeChat||!user||auth?.currentUser?.uid!==user.uid)return;
 if(text.length>2000){notice('Максимум 2000 символов');return;}
 const ref=fs.doc(fs.collection(db,'chats',activeChat,'messages'));
 const message={id:ref.id,text,chatId:activeChat,senderId:user.uid,session:userGeneration,createdAt:fs.Timestamp.now(),status:'sending'};
 input.value='';input.style.height='';drafts.delete(activeChat);transmit(message);
};
$('msgInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px';if(activeChat)drafts.set(activeChat,e.target.value);});
$('msgInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&window.innerWidth>700){e.preventDefault();$('composer').requestSubmit();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('modalBack').classList.contains('open'))closeModal();else if(activeChat){closeConversation();renderList();}}});
function fitViewport(){const viewport=window.visualViewport;document.documentElement.style.setProperty('--app-height',(viewport?.height||window.innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',fitViewport);window.addEventListener('resize',fitViewport);fitViewport();

applyTheme();showAuth();authMessage('Подключаем Firebase…',true);$('authSubmit').disabled=true;
const missing=['apiKey','projectId','appId','authDomain'].some(k=>!firebaseConfig[k]||String(firebaseConfig[k]).includes('PASTE_'));
if(missing){authMessage('Не заполнены настройки firebaseConfig.');$('authSetup').hidden=false;return;}
(async()=>{
 try{
  const [appModule,authModule,firestoreModule]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
   import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
  ]);
  authSDK=authModule;fs=firestoreModule;
  const firebaseApp=appModule.initializeApp(firebaseConfig);
  auth=authModule.getAuth(firebaseApp);db=firestoreModule.getFirestore(firebaseApp);
  auth.languageCode='ru';readySdk=true;$('authSubmit').disabled=false;authMessage('');
  authModule.onAuthStateChanged(auth,next=>{if(!authBusy){loadSession(next).catch(e=>authMessage(explain(e))) }},e=>authMessage(explain(e)));
 }catch(err){console.error('Firebase init:',err);authMessage('Не удалось загрузить Firebase. Проверь интернет, используй HTTPS и повтори. '+explain(err));$('authSubmit').disabled=false;}
})();
})();
