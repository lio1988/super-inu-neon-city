import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=await realpath(fileURLToPath(new URL('./dist/',import.meta.url)));
const types={'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'text/javascript;charset=utf-8','.mjs':'text/javascript;charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.json':'application/json;charset=utf-8','.txt':'text/plain;charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1');let name=decodeURIComponent(url.pathname);if(name==='/')name='/index.html';
  const candidate=path.resolve(root,'.'+name);if(!candidate.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const resolved=await realpath(candidate);if(!resolved.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  const info=await stat(resolved);if(!info.isFile()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(resolved)]??'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
  if(req.method==='HEAD')res.end();else createReadStream(resolved).pipe(res);
}catch{res.writeHead(404);res.end();}});
server.listen(8051,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8051/ — only dist/ is served; no public network binding.'));
function stop(){server.close(()=>process.exit(0));}process.on('SIGINT',stop);process.on('SIGTERM',stop);
