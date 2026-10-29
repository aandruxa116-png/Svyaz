import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
http.createServer(async(req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  let body=await readFile(target);
  if(target.endsWith('/app.js'))body=Buffer.from(body.toString().replaceAll('https://www.gstatic.com/firebasejs/11.10.0/','/tests/.sdk/'));
  res.setHeader('content-type',target.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(body);
 }catch{res.writeHead(404).end();}
}).listen(4173,'127.0.0.1');
