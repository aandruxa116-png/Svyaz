export * from 'firebase/app';
import { initializeApp as initialize } from 'firebase/app';
// Only the test HTTP server maps SDK URLs to these modules. The published app never imports them.
export function initializeApp() {
  return initialize({projectId:'demo-svyaz',apiKey:'synthetic-key',authDomain:'localhost'});
}
