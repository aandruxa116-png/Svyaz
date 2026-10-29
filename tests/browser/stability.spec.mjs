import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import * as sdk from 'firebase/firestore';
import { openPrivate, sendText } from '../../data.js';
let env, a, b, appA, appB, storeA, storeB, chatId;
const password='Synthetic-only-123';
async function client(name) {
 const app=initializeApp({projectId:'demo-svyaz',apiKey:'synthetic-key'},name+'-'+Date.now());
 const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
 const store=sdk.getFirestore(app);sdk.connectFirestoreEmulator(store,'127.0.0.1',8080);
 const email=name+'-'+Date.now()+'@example.test';
 const user=(await createUserWithEmailAndPassword(auth,email,password)).user;
 return {app,store,uid:user.uid,email};
}
test.beforeAll(async()=>{
 const rules=await readFile(process.env.FIRESTORE_RULES_PATH||'tests/emulator-only.rules','utf8');
 env=await initializeTestEnvironment({projectId:'demo-svyaz',firestore:{rules}});
});
test.beforeEach(async()=>{
 await env.clearFirestore();
 a=await client('alice');b=await client('bob');appA=a.app;appB=b.app;storeA=a.store;storeB=b.store;
 await env.withSecurityRulesDisabled(async ctx=>{
  const store=ctx.firestore();
  for(const person of [a,b]){
   const handle=person===a?'alice':'bob';
   await sdk.setDoc(sdk.doc(store,'users',person.uid),{displayName:handle,handle,createdAt:new Date(0)});
   await sdk.setDoc(sdk.doc(store,'handles',handle),{uid:person.uid});
  }
 });
 chatId=(await openPrivate(sdk,storeA,a.uid,b.uid)).id;
});
test.afterEach(async()=>{for(const app of [appA,appB]){await sdk.terminate(sdk.getFirestore(app));await deleteApp(app);}});
test.afterAll(async()=>{await env.cleanup();});
async function login(page,person=a){
 // Any attempted production network access is a test failure; SDK modules are served only by the fixture server.
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  return route.continue();
 });
 await page.goto('/');
 await expect(page.locator('#authSubmit')).toBeEnabled();
 await page.locator('#authEmail').fill(person.email);await page.locator('#authPassword').fill(password);await page.locator('#authSubmit').click();
 await expect(page.locator('.chatrow')).toBeVisible();
}
async function open(page){await page.locator('.chatrow').first().click();await expect(page.locator('#conversation')).toHaveClass(/active/);}
test('mobile send/receive retains new input, sender side and scroll; browser back returns to chat list',async({page})=>{
 await login(page);await open(page);
 await page.locator('#msgInput').fill('Привет 👋\nВторая строка');await page.locator('.send').click();
 await page.locator('#msgInput').fill('Новый текст не очищать');
 await expect(page.locator('.msg.mine')).toContainText('Привет 👋');
 await expect(page.locator('#msgInput')).toHaveValue('Новый текст не очищать');
 await sendText(sdk,storeB,b.uid,chatId,{id:'reply',text:'Ответ Б'});
 await expect(page.locator('.msg:not(.mine)')).toContainText('Ответ Б');
 await page.goBack();await expect(page.locator('#app')).not.toHaveClass(/inchat/);await expect(page.locator('.chatrow')).toBeVisible();
});
test('reopening DM keeps all original fields; Android handle change is reflected live',async({page})=>{
 await sendText(sdk,storeB,b.uid,chatId,{id:'prior',text:'Сохранить историю'});
 const before=(await sdk.getDocFromServer(sdk.doc(storeA,'chats',chatId))).data();
 await login(page);await page.locator('[data-tab="contacts"]').click();await page.locator('#peopleInput').fill('@bob');await page.locator('#findPersonBtn').click();
 await page.locator('#personChat').click();await expect(page.locator('.msg')).toContainText('Сохранить историю');
 const after=(await sdk.getDocFromServer(sdk.doc(storeA,'chats',chatId))).data();assert.deepEqual(after,before);
 const batch=sdk.writeBatch(storeB);batch.delete(sdk.doc(storeB,'handles/bob'));batch.set(sdk.doc(storeB,'handles/bob_new'),{uid:b.uid});
 batch.update(sdk.doc(storeB,'users',b.uid),{handle:'bob_new',displayName:'Боб новый'});await batch.commit();
 await expect(page.locator('#convName')).toHaveText('Боб новый');await expect(page.locator('#convStatus')).toHaveText('@bob_new');
});
test('failed send retains text and reuses ID on retry; legacy ciphertext never appears',async({page})=>{
 await sendText(sdk,storeB,b.uid,chatId,{id:'legacy',text:'e2ee1.secret'});
 await login(page);await open(page);await expect(page.locator('#messages')).toContainText('Сообщение из старой версии недоступно');
 await expect(page.locator('#messages')).not.toContainText('e2ee1.secret');
 // Transaction RPCs fail offline instead of queuing writes with new IDs.
 await page.context().setOffline(true);
 await page.locator('#msgInput').fill('Сохранить при ошибке');await page.locator('.send').click();
 await expect(page.locator('[data-retry]')).toBeVisible({timeout:35000});
 const id=await page.locator('[data-retry]').getAttribute('data-retry');
 await page.context().setOffline(false);await page.locator('[data-retry]').click();
 await expect(page.locator('[data-retry]')).toHaveCount(0,{timeout:30000});
 const messages=await sdk.getDocs(sdk.collection(storeB,'chats',chatId,'messages'));
 assert.equal(messages.docs.filter(d=>d.data().text==='Сохранить при ошибке').length,1);
 assert.equal(messages.docs.find(d=>d.data().text==='Сохранить при ошибке').id,id);
});
test('logout clears old messages, input and profile before another user signs in',async({page})=>{
 await sendText(sdk,storeA,a.uid,chatId,{id:'secret',text:'История пользователя А'});
 await login(page);await open(page);await page.locator('#msgInput').fill('Черновик А');
 await page.locator('#back').click();await page.locator('[data-tab="settings"]').click();
 await expect(page.locator('.profilehero')).toContainText(a.email);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#logoutSetting').click();
 await expect(page.locator('#authGate')).toBeVisible();await expect(page.locator('#messages')).toBeEmpty();await expect(page.locator('#msgInput')).toHaveValue('');
 await expect(page.locator('#list')).not.toContainText(a.email);
 await page.locator('#authEmail').fill(b.email);await page.locator('#authPassword').fill(password);await page.locator('#authSubmit').click();
 await expect(page.locator('.chatrow')).toBeVisible();await page.locator('[data-tab="settings"]').click();
 await expect(page.locator('.profilehero')).toContainText(b.email);await expect(page.locator('.profilehero')).not.toContainText(a.email);
});
test('keyboard-sized viewport does not clip composer; switching chats cannot carry another chat input',async({page})=>{
 await login(page);await open(page);await page.setViewportSize({width:360,height:340});
 const box=await page.locator('#msgInput').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(341);
 await page.locator('#msgInput').fill('draft for this chat');await page.locator('#back').click();
 await open(page);await expect(page.locator('#msgInput')).toHaveValue('draft for this chat');
});
