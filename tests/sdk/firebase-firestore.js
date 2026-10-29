export * from 'firebase/firestore';
import { getFirestore as get, connectFirestoreEmulator } from 'firebase/firestore';
const connected=new WeakSet();
export function getFirestore(app) {
  const store=get(app);
  if(!connected.has(store)){connectFirestoreEmulator(store,'127.0.0.1',8080);connected.add(store);}
  return store;
}
