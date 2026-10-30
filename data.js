// Public web client operations. No Android source or production credentials are used by tests.
export const LEGACY_MESSAGE = 'Сообщение из старой версии недоступно';
export function visibleText(text) {
  const value = String(text ?? '');
  return /^\s*e2ee/i.test(value) ? LEGACY_MESSAGE : value;
}
export function normalizeHandle(value) { return value.trim().replace(/^@/, '').toLowerCase(); }
export function sameMembers(chat, uid, peer) {
  return chat.type === 'private' && Array.isArray(chat.members) && chat.members.length === 2 && chat.members.includes(uid) && chat.members.includes(peer);
}
export async function openPrivate(sdk, db, uid, peer, knownChats = []) {
  if (!uid || !peer || uid === peer) throw Error('Выберите другого пользователя.');
  const known = knownChats.find(chat => sameMembers(chat, uid, peer));
  const members = [uid, peer].sort();
  const id = known?.id ?? 'dm_' + members.join('_');
  const ref = sdk.doc(db, 'chats', id);
  await sdk.runTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if (!sameMembers(existing.data(), uid, peer)) throw Error('Некорректный состав личного чата.');
      return; // Never overwrite owner, timestamps, last preview, history or legacy fields.
    }
    if (known) throw Error('Чат больше недоступен. Обновите список.');
    tx.set(ref, { type: 'private', title: '', members, owner: uid, createdAt: sdk.serverTimestamp(),
      updatedAt: sdk.serverTimestamp(), lastText: '', lastSenderId: '', lastMessageId: '' });
  });
  const snapshot = await sdk.getDocFromServer(ref);
  if (!snapshot.exists() || !sameMembers(snapshot.data(), uid, peer)) throw Error('Переписка недоступна.');
  return { id, ...snapshot.data() };
}
export async function sendText(sdk, db, uid, chatId, message) {
  if (!message.text.trim() || message.text.length > 2000) throw Error('Сообщение: от 1 до 2000 символов.');
  const chat = sdk.doc(db, 'chats', chatId);
  const ref = sdk.doc(db, 'chats', chatId, 'messages', message.id);
  await sdk.runTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      if (existing.data().senderId !== uid || existing.data().text !== message.text) throw Error('Конфликт ID сообщения.');
      return;
    }
    tx.set(ref, { senderId: uid, text: message.text, createdAt: sdk.serverTimestamp() });
    tx.update(chat, { lastText: message.text, lastSenderId: uid, lastMessageId: message.id, updatedAt: sdk.serverTimestamp() });
  });
}
export async function createProfile(sdk, db, uid, displayName, handle) {
  await sdk.runTransaction(db, async tx => {
    const user = sdk.doc(db, 'users', uid), claim = sdk.doc(db, 'handles', handle);
    const profile = await tx.get(user), owner = await tx.get(claim);
    if (profile.exists()) throw Error('Профиль уже создан. Нажмите «Повторить загрузку».');
    if (owner.exists()) throw Error('Этот никнейм уже занят.');
    tx.set(claim, { uid });
    tx.set(user, { displayName, handle, createdAt: sdk.serverTimestamp() });
  });
}
export function compareMessages(a, b) {
  const time = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
  const nanos = (a.createdAt?.nanoseconds ?? 0) - (b.createdAt?.nanoseconds ?? 0);
  return time || nanos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export async function editProfile(sdk, db, uid, displayName, rawHandle) {
  const handle = normalizeHandle(rawHandle), name = displayName.trim();
  if (!name || name.length > 45 || !/^[a-z0-9_]{3,20}$/.test(handle)) throw Error('Имя: 1–45 символов. Никнейм: 3–20 символов, a–z, 0–9 и _.');
  await sdk.runTransaction(db, async tx => {
    const user = sdk.doc(db, 'users', uid), claim = sdk.doc(db, 'handles', handle);
    const previous = await tx.get(user), owner = await tx.get(claim);
    if (!previous.exists()) throw Error('Профиль недоступен. Повторите вход.');
    if (owner.exists() && owner.data().uid !== uid) throw Error('Этот никнейм уже занят.');
    const old = previous.data().handle;
    const oldRef = old && old !== handle && /^[a-z0-9_]{3,20}$/.test(old) ? sdk.doc(db, 'handles', old) : null;
    const oldClaim = oldRef ? await tx.get(oldRef) : null;
    if (oldClaim?.exists() && oldClaim.data().uid === uid) tx.delete(oldRef);
    tx.set(claim, { uid });
    tx.update(user, { displayName: name, handle });
  });
}

export const AVATAR_COLORS = ['#326A9C', '#6257A5', '#276D77', '#8F5076'];
export function initials(name) {
  return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase('ru') || 'С';
}
export function avatarColor(name) {
  const value=String(name || '');let hash=0;
  for(let i=0;i<value.length;i++)hash=(31*hash+value.charCodeAt(i))|0;
  return AVATAR_COLORS[(hash>>>0)%AVATAR_COLORS.length];
}
