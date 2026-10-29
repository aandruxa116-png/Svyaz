import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPrivate, sendText, createProfile, visibleText, compareMessages } from '../data.js';
function fake(documents = {}) {
  const writes = [];
  const sdk = {
    doc: (_db, ...parts) => parts.join('/'), serverTimestamp: () => 'server-time',
    getDocFromServer: async ref => ({ exists: () => !!documents[ref], data: () => documents[ref] }),
    runTransaction: async (_db, update) => update({
      get: async ref => ({ exists: () => !!documents[ref], data: () => documents[ref] }),
      set: (ref, data) => { writes.push(['set', ref, data]); documents[ref] = data; },
      update: (ref, data) => { writes.push(['update', ref, data]); documents[ref] = { ...documents[ref], ...data }; }
    })
  };
  return { sdk, writes, documents };
}
test('opening an existing DM never writes owner, preview, metadata or timestamps', async () => {
  const original = { type:'private', members:['alice','bob'], owner:'bob', lastText:'keep', lastMessageId:'saved', createdAt:1, updatedAt:2, custom:'legacy' };
  const f = fake({ 'chats/dm_alice_bob': original });
  await openPrivate(f.sdk, {}, 'alice','bob');
  assert.deepEqual(f.writes, []); assert.deepEqual(f.documents['chats/dm_alice_bob'], original);
});
test('legacy random DM is reused rather than creating canonical duplicate', async () => {
  const chat = { id:'old-id', type:'private', members:['bob','alice'] };
  const f = fake({ 'chats/old-id': chat });
  assert.equal((await openPrivate(f.sdk, {}, 'alice','bob', [chat])).id, 'old-id');
  assert.equal(f.writes.length, 0);
});
test('new DM ID is identical for either initiator', async () => {
  const a=fake(), b=fake();
  assert.equal((await openPrivate(a.sdk,{},'alice','bob')).id, (await openPrivate(b.sdk,{},'bob','alice')).id);
  assert.equal(a.writes.length,1);
});
test('uncertain successful send can be retried without writes or timestamp reset', async () => {
  const f=fake({ 'chats/chat/messages/stable':{senderId:'alice',text:'Привет 👋\nСтрока',createdAt:1} });
  await sendText(f.sdk,{},'alice','chat',{id:'stable',text:'Привет 👋\nСтрока'});
  assert.equal(f.writes.length,0);
});
test('a new send atomically includes text and compatible header', async () => {
  const f=fake();await sendText(f.sdk,{},'alice','chat',{id:'id',text:'hello'});
  assert.deepEqual(f.writes.map(w=>w[0]),['set','update']);
  assert.equal(f.documents['chats/chat'].lastMessageId,'id');
  await assert.rejects(sendText(f.sdk,{},'alice','chat',{id:'other',text:' '}));
});
test('onboarding cannot overwrite existing Android profile or claim an extra handle', async () => {
  const f=fake({ 'users/alice':{handle:'new_name',displayName:'Alice'} });
  await assert.rejects(createProfile(f.sdk,{},'alice','old','old_name'),/Профиль уже создан/);
  assert.equal(f.writes.length,0);
});
test('all legacy ciphertext versions remain hidden',()=>{
  for(const value of ['e2ee1.cipher',' E2EE2.bad','\ne2ee-malformed'])assert.equal(visibleText(value),'Сообщение из старой версии недоступно');
  assert.equal(visibleText('Привет 👋\nтекст'),'Привет 👋\nтекст');
});
test('ordering includes nanoseconds and document ID tie breaker',()=>{
  const a={id:'z',createdAt:{seconds:1,nanoseconds:1}}, b={id:'a',createdAt:{seconds:1,nanoseconds:2}};
  assert.deepEqual([b,a].sort(compareMessages),[a,b]);
  assert.deepEqual([{...a,id:'z'},{...a,id:'a'}].sort(compareMessages).map(m=>m.id),['a','z']);
});
