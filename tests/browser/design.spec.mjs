import {test,expect} from '@playwright/test';
import {readFile,access} from 'node:fs/promises';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword} from 'firebase/auth';
import * as sdk from 'firebase/firestore';
import {createProfile,openPrivate,sendText} from '../../data.js';
let env,a,b,chat;
const password='Synthetic-design-123';
async function client(kind,name,handle){
 const stamp=Date.now(),app=initializeApp({projectId:'demo-svyaz',apiKey:'synthetic-key'},`design-${kind}-${stamp}`);
 const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
 const store=sdk.getFirestore(app);sdk.connectFirestoreEmulator(store,'127.0.0.1',8080);
 const email=`design-${kind}-${stamp}@example.test`,user=(await createUserWithEmailAndPassword(auth,email,password)).user;
 await createProfile(sdk,store,user.uid,name,handle);return {app,auth,store,email,uid:user.uid};
}
test.beforeAll(async()=>{
 const rules=await readFile(process.env.FIRESTORE_RULES_PATH||'tests/emulator-only.rules','utf8');
 env=await initializeTestEnvironment({projectId:'demo-svyaz',firestore:{rules}});
});
test.beforeEach(async()=>{
 await env.clearFirestore();a=await client('a','Анна Смирнова','anna_design');b=await client('b','Марк Волков','mark_design');
 chat=await openPrivate(sdk,a.store,a.uid,b.uid);
 await sendText(sdk,b.store,b.uid,chat.id,{id:'design-1',text:'Привет, Анна! Как тебе новая Связь?'});
 await sendText(sdk,a.store,a.uid,chat.id,{id:'design-2',text:'Привет! Теперь всё под рукой 💙\nИ можно продолжить разговор с телефона.'});
 await sdk.setDoc(sdk.doc(a.store,'chats/design-team'),{type:'group',title:'Команда Связь',members:[a.uid,b.uid],owner:a.uid,createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp(),lastText:'',lastSenderId:'',lastMessageId:''});
 await sendText(sdk,b.store,b.uid,'design-team',{id:'team-1',text:'Встречаемся здесь завтра в 10:00'});
});
test.afterEach(async()=>{for(const person of [a,b]){await sdk.terminate(person.store);await deleteApp(person.app);}});
test.afterAll(async()=>{await env.cleanup();});
async function visit(page,base='/'){
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.goto(base);await expect(page.locator('#authSubmit')).toBeEnabled();
 await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
}
async function login(page){
 await page.locator('#authEmail').fill(a.email);await page.locator('#authPassword').fill(password);await page.locator('#authSubmit').click();
 await expect(page.locator('.chatrow')).toHaveCount(2);await expect(page.locator('.chatrow').filter({hasText:'Марк Волков'})).toBeVisible();
}
async function capture(page,testInfo,name){
 const bytes=await page.screenshot({path:testInfo.outputPath(name+'.png'),animations:'disabled'});
 if(process.env.DESIGN_PREVIEWS==='1'&&['before-mobile-03-chats','after-mobile-03-chats','after-mobile-04-conversation','after-mobile-05-profile'].includes(name))console.log('SVYAZ_PREVIEW|web-'+name+'|'+bytes.toString('base64'));
}
test('before and after screens use the same synthetic accounts and real UI',async({browser},testInfo)=>{
 test.setTimeout(120000);await access('tests/.baseline/index.html');
 for(const [size,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
  for(const stage of ['before','after']){
   const context=await browser.newContext({viewport});const page=await context.newPage();
   try{
    await visit(page,stage==='before'?'/before/':'/');await capture(page,testInfo,`${stage}-${size}-01-login`);
    await page.locator('#authSwitch').click();await capture(page,testInfo,`${stage}-${size}-02-register`);await page.locator('#authSwitch').click();
    await login(page);await capture(page,testInfo,`${stage}-${size}-03-chats`);
    await page.locator('.chatrow').filter({hasText:'Марк Волков'}).click();await expect(page.locator('.msg')).toHaveCount(2);
    await capture(page,testInfo,`${stage}-${size}-04-conversation`);
    if(size==='mobile')await page.locator('#back').click();
    await page.locator('[data-tab="settings"]').click();await expect(page.locator('.profilehero')).toContainText('Анна Смирнова');
    await capture(page,testInfo,`${stage}-${size}-05-profile`);
    if(stage==='after'){
     await page.locator('#renameSetting').click();await expect(page.locator('#editProfileDialog')).toBeVisible();
     await capture(page,testInfo,`${stage}-${size}-06-edit-profile`);await page.locator('#editCancel').click();
    }
    await page.locator('[data-tab="contacts"]').click();await page.locator('#peopleInput').fill('mark_design');await page.locator('#findPersonBtn').click();
    await expect(page.locator('#personChat')).toBeVisible();await capture(page,testInfo,`${stage}-${size}-07-search`);
   }finally{await context.close();}
  }
 }
});
test('styled profile editor saves name and handle atomically and reports occupied handles',async({page})=>{
 await visit(page);await login(page);await page.locator('[data-tab="settings"]').click();await page.locator('#renameSetting').click();
 await page.locator('#editName').fill('Анна — новое имя');await page.locator('#editHandle').fill('mark_design');await page.locator('#editSave').click();
 await expect(page.locator('#editError')).toContainText('занят');await expect(page.locator('#editProfileDialog')).toBeVisible();
 await page.locator('#editHandle').fill('anna_new');await page.locator('#editSave').click();await expect(page.locator('#editProfileDialog')).toBeHidden();
 await expect(page.locator('.profilehero')).toContainText('@anna_new');await expect(page.locator('.profilehero')).toContainText('Анна — новое имя');
 expect((await sdk.getDocFromServer(sdk.doc(b.store,'handles/anna_design'))).exists()).toBe(false);
 expect((await sdk.getDocFromServer(sdk.doc(b.store,'handles/anna_new'))).data().uid).toBe(a.uid);
});
test('large fonts, light theme and offline status stay readable without horizontal overflow',async({page},testInfo)=>{
 await visit(page);await login(page);await page.locator('#themeQuick').click();await expect(page.locator('body')).toHaveClass(/light/);
 await page.evaluate(()=>{document.documentElement.style.fontSize='24px';});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await capture(page,testInfo,'after-mobile-large-font-light');
 await page.locator('.chatrow').filter({hasText:'Марк Волков'}).click();await page.context().setOffline(true);
 await expect(page.locator('#conversation [data-connection]')).toBeVisible();
 await page.locator('#msgInput').fill('Сообщение без сети');await page.locator('.send').click();await expect(page.locator('[data-retry]')).toBeVisible();
 await capture(page,testInfo,'after-mobile-large-font-offline');
 await page.context().setOffline(false);
});
