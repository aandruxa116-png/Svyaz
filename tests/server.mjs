import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const root=process.cwd();
http.createServer(async(req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const before=pathname.startsWith('/before/');
  const selectedRoot=before?path.resolve(root,'tests/.baseline'):root;
  const relative=before?pathname.slice('/before'.length):pathname;
  const target=path.resolve(selectedRoot,'.'+(relative==='/'?'/index.html':relative));
  if(!target.startsWith(selectedRoot+path.sep)){res.writeHead(403).end();return;}
  let body=await readFile(target);
  if(target.endsWith('/app.js'))body=Buffer.from(body.toString().replaceAll('https://www.gstatic.com/firebasejs/11.10.0/','/tests/.sdk/'));
  res.setHeader('content-type',types[path.extname(target)]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404).end();}
}).listen(4173,'127.0.0.1');
