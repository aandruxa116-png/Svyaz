export * from 'firebase/auth';
import { getAuth as get, connectAuthEmulator, onAuthStateChanged as observe } from 'firebase/auth';
const connected = new WeakSet();
export function getAuth(app) {
  const auth=get(app);
  if(!connected.has(auth)){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connected.add(auth);}
  return auth;
}

export function onAuthStateChanged(auth, next, error) {
 let initial=true;
 return observe(auth,user=>{
  const delay=initial?(globalThis.__testInitialAuthDelay||0):0;initial=false;
  if(delay)setTimeout(()=>{next(user);globalThis.__testInitialAuthDelivered=true;},delay);else next(user);
 },error);
}
