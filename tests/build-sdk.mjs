import { build } from 'esbuild';
await build({entryPoints:['tests/sdk/firebase-app.js','tests/sdk/firebase-auth.js','tests/sdk/firebase-firestore.js'],
  bundle:true,splitting:true,format:'esm',outdir:'tests/.sdk',platform:'browser'});
