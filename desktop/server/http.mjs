import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LOCAL_AUTH } from './context.mjs';

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4'};
const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const json=(res,status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const body=async(req,limit)=>{const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw new Error('LIMIT');parts.push(chunk);}return Buffer.concat(parts);};
const serveFile=(req,res,file,media=false)=>{
  let stat;try{stat=fs.statSync(file);}catch{return json(res,404,{error:'File not found.'});}if(!stat.isFile()||fs.lstatSync(file).isSymbolicLink())return json(res,404,{error:'File not found.'});
  const extension=path.extname(file).toLowerCase();
  const safeMedia=/^\.(png|jpe?g|webp|avif|mp4|webm|mov|mp3|wav|m4a)$/.test(extension);
  res.setHeader('Content-Type',media&&!safeMedia?'application/octet-stream':MIME[extension]||'application/octet-stream');
  if(media&&!safeMedia)res.setHeader('Content-Disposition','attachment');
  res.setHeader('Accept-Ranges','bytes');
  const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);let start=0,end=stat.size-1;
  if(req.headers.range&&!range){res.setHeader('Content-Range',`bytes */${stat.size}`);res.statusCode=416;return res.end();}
  if(range){if(!range[1]){start=Math.max(0,stat.size-Number(range[2]));}else{start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end){res.statusCode=416;res.setHeader('Content-Range',`bytes */${stat.size}`);return res.end();}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`);}
  res.setHeader('Content-Length',Math.max(0,end-start+1));if(req.method==='HEAD')return res.end();if(!stat.size)return res.end();fs.createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
};

const LOGIN_PAGE=failed=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Banana Studio</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font:15px system-ui,sans-serif}form{width:min(22rem,calc(100% - 3rem));display:grid;gap:.75rem}input,button{font:inherit;padding:.7rem .9rem;border-radius:.6rem;border:1px solid #30363d;background:#161b22;color:inherit}button{background:#7c3aed;border-color:#7c3aed;cursor:pointer}p{margin:0;color:#f85149}</style></head><body><form method="post" action="/local/login"><strong>Banana Studio</strong><label for="token">Access token</label><input id="token" name="token" type="password" autocomplete="current-password" required autofocus>${failed?'<p role="alert">The access token is not correct.</p>':''}<button type="submit">Open workspace</button></form></body></html>`;
const tokenDigest=token=>createHash('sha256').update(String(token)).digest('hex');

/**
 * `server` runs the same workspace for a browser on another device (the Docker image):
 * it listens on `server.host:server.port`, accepts requests only for `server.publicOrigin`, and
 * replaces the native launch handshake with a login form. In that mode `bootstrap` is the
 * SHA-256 digest of the access token, so the token itself is never stored or sent back.
 */
export async function startLocalServer({ workspace, root, bootstrap, routes={}, onWake=()=>{}, server:hosted=null }) {
  if(!/^[a-f0-9]{64}$/.test(bootstrap))throw new Error('A native launch credential is required.');
  const publicOrigin=hosted?new URL(hosted.publicOrigin).origin:null;
  const cookieName='banana_'+bootstrap.slice(0,12);
  const cookieAttributes=`HttpOnly; SameSite=Strict; Path=/${publicOrigin?.startsWith('https:')?'; Secure':''}${hosted?'; Max-Age=2592000':''}`;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.status=function(status){this.statusCode=status;return this;};res.json=function(value){json(this,this.statusCode||200,value);return this;};
    try {
      if(req.headers.host!==new URL(workspace.origin).host)return json(res,403,{error:'Invalid local host.'});
      const url=new URL(req.url,workspace.origin);
      if(req.headers.origin&&req.headers.origin!==workspace.origin)return json(res,403,{error:'Cross-origin requests are not allowed.'});
      if(!hosted&&url.pathname==='/local/bootstrap'&&req.method==='GET'){
        if(!equal(req.headers['x-banana-bootstrap'],bootstrap))return json(res,401,{error:'Native launch required.'});
        res.setHeader('Set-Cookie',`${cookieName}=${bootstrap}; HttpOnly; SameSite=Strict; Path=/`);res.statusCode=303;res.setHeader('Location','/');return res.end();
      }
      if(hosted&&url.pathname==='/local/health'&&req.method==='GET')return json(res,200,{ready:true});
      // A form navigation under `no-referrer` sends `Origin: null`; this page keeps its origin so the POST can be checked.
      if(hosted&&url.pathname==='/local/login'&&req.method==='GET'){res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(LOGIN_PAGE(url.searchParams.has('failed')));}
      if(hosted&&url.pathname==='/local/login'&&req.method==='POST'){
        if(req.headers.origin!==workspace.origin)return json(res,403,{error:'Local request origin required.'});
        const token=new URLSearchParams((await body(req,4096)).toString()).get('token')||'';
        res.statusCode=303;
        if(!equal(tokenDigest(token),bootstrap)){await new Promise(resolve=>setTimeout(resolve,1000));res.setHeader('Location','/local/login?failed');return res.end();}
        res.setHeader('Set-Cookie',`${cookieName}=${bootstrap}; ${cookieAttributes}`);res.setHeader('Location','/');return res.end();
      }
      const cookie=String(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      if(!equal(cookie,bootstrap)){
        if(hosted&&['GET','HEAD'].includes(req.method)&&!/^\/(?:api|local|storage)\//.test(url.pathname)){res.statusCode=303;res.setHeader('Location','/local/login');return res.end();}
        return json(res,401,{error:'Open this workspace in Banana Studio.'});
      }
      req[LOCAL_AUTH]=true;
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==workspace.origin)return json(res,403,{error:'Local request origin required.'});
      if(hosted&&url.pathname==='/local/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',`${cookieName}=; ${cookieAttributes.replace(/; Max-Age=\d+/,'')}; Max-Age=0`);res.statusCode=303;res.setHeader('Location','/local/login');return res.end();}
      if(url.pathname==='/api/workspace-config'&&req.method==='GET')return json(res,200,{mode:'local',...workspace.identity,...(hosted?{server:true}:{})});
      if(url.pathname==='/local/query'&&req.method==='POST'){
        if(!String(req.headers['content-type']).startsWith('application/json'))return json(res,415,{error:'JSON is required.'});
        const plan=JSON.parse((await body(req,16*1024*1024)).toString());
        return json(res,200,workspace.materialize(workspace.execute(plan,false)));
      }
      if(url.pathname==='/local/upload'&&req.method==='POST'){
        const key=decodeURIComponent(String(req.headers['x-media-path']||''));workspace.mediaPath(key);
        const bytes=await body(req,512*1024*1024);return json(res,200,await workspace.upload(key,bytes,{upsert:req.headers['x-upsert']==='true'}));
      }
      const media=url.pathname.match(/^\/storage\/v1\/object\/authenticated\/media\/(.+)$/);
      if(media&&['GET','HEAD'].includes(req.method))return serveFile(req,res,workspace.mediaPath(decodeURIComponent(media[1])),true);
      if(url.pathname==='/local/health'&&req.method==='GET')return json(res,200,{ready:true});
      if(url.pathname.startsWith('/api/')) {
        const route=routes[url.pathname.slice(5)];if(!route)return json(res,404,{error:'This feature is not available in local mode.'});
        req.query=Object.fromEntries(url.searchParams);req.body=undefined;
        if(req.method==='POST')req.body=JSON.parse((await body(req,16*1024*1024)).toString()||'{}');
        await route(req,res);onWake();return;
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
      const relative=decodeURIComponent(url.pathname);if(relative.includes('\0')||relative.includes('\\')||relative.split('/').some(p=>p==='..'||p.startsWith('.')))return json(res,404,{error:'File not found.'});
      const file=path.resolve(root,'.'+relative);if(!file.startsWith(path.resolve(root)+path.sep)&&file!==path.resolve(root))return json(res,404,{error:'File not found.'});
      return serveFile(req,res,relative==='/'?path.join(root,'index.html'):file);
    } catch(error) { if(!res.headersSent)json(res,error.message==='LIMIT'?413:400,{error:error.message==='LIMIT'?'The file exceeds the local upload limit.':'The local request could not be completed.'});else res.end(); }
  });
  server.requestTimeout=600_000;server.headersTimeout=20_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(hosted?hosted.port:0,hosted?hosted.host:'127.0.0.1',resolve);});
  workspace.origin=publicOrigin||`http://127.0.0.1:${server.address().port}`;
  return { server,origin:workspace.origin,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}) };
}
