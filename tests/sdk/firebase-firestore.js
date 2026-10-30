export * from 'firebase/firestore';
import { getDocsFromServer as readServer, getFirestore as get, connectFirestoreEmulator } from 'firebase/firestore';
const connected=new WeakSet();
export function getFirestore(app) {
  const store=get(app);
  if(!connected.has(store)){connectFirestoreEmulator(store,'127.0.0.1',8080);connected.add(store);}
  return store;
}

// Test fixture only: keep an already-started history read pending across navigation.
export async function getDocsFromServer(query) {
  const delay=globalThis.__testHistoryDelay||0;
  if(delay)globalThis.__testHistoryReadStarted=true;
  const result=await readServer(query);
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  return result;
}
