export * from 'firebase/auth';
import { getAuth as get, connectAuthEmulator } from 'firebase/auth';
const connected = new WeakSet();
export function getAuth(app) {
  const auth=get(app);
  if(!connected.has(auth)){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connected.add(auth);}
  return auth;
}
