import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {fork} from 'node:child_process';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),scenario=process.argv[2];
if(!['i18n','alpha','lazy','startup'].includes(scenario))throw new Error('Use i18n, alpha, lazy or startup');
const supplied=process.argv[3];const output=path.join(root,'.build','acceptance-'+scenario+(supplied?'-'+path.basename(supplied):'')+'-served');fs.mkdirSync(path.dirname(output),{recursive:true});fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
if(supplied){const source=fs.realpathSync(path.resolve(root,supplied));if(!source.startsWith(root+path.sep)||!fs.existsSync(path.join(source,'index.html')))throw new Error('Only this checkout build roots are allowed');fs.cpSync(source,output,{recursive:true});}
else{
 const plugins=scenario==='alpha'?[{name:'expose-actual-private-budget-for-test',setup(b){b.onLoad({filter:/[/\\]src[/\\]services[/\\]geminiService\.ts$/},a=>({contents:fs.readFileSync(a.path,'utf8')+'\nexport {shrinkInlineImagesToBudget};',loader:'ts'}));}}]:[];
 await build({entryPoints:[path.join(root,'tests/ui',scenario+'-acceptance.bootstrap.ts')],outdir:output,entryNames:'bootstrap',bundle:true,splitting:true,format:'esm',platform:'browser',jsx:'automatic',plugins});
 fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="connect-src 'self'"><title>${scenario} offline acceptance</title></head><body><div id="root"></div><script type="module" src="/bootstrap.js"></script></body></html>`);
}
if(scenario==='startup'){
 fs.writeFileSync(path.join(output,'acceptance-metrics.js'),`const start=performance.now();let firstPaint=null;new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.name==='first-contentful-paint')firstPaint=e.startTime;}).observe({type:'paint',buffered:true});const o=new MutationObserver(()=>{if(!document.querySelector('textarea[aria-label="Generation prompt"]'))return;o.disconnect();const p=document.createElement('pre');p.id='acceptance-metrics';p.style='position:fixed;top:0;left:0;z-index:99999;background:black;color:white;padding:8px;max-width:90vw';p.textContent=JSON.stringify({appReadyMs:Math.round(performance.now()*100)/100,firstContentfulPaintMs:firstPaint,readyDefinition:'actual App generation prompt mounted',resourceCount:performance.getEntriesByType('resource').length});document.body.append(p);});o.observe(document.documentElement,{childList:true,subtree:true});`);
 const file=path.join(output,'index.html');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'"><script type="module" src="/acceptance-metrics.js"></script>'));
}
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-acceptance-'));fs.writeFileSync(path.join(directory,'.synthetic-acceptance'),'No user data.');let child;const all=[];
const launch=()=>new Promise((resolve,reject)=>{const next=fork(path.join(root,'tests/helpers/acceptance-server.mjs'),[output,directory],{cwd:root,execPath:process.execPath,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe','ipc']});all.push(next);next.stderr.on('data',b=>process.stderr.write(b));next.once('error',reject);next.once('message',m=>{if(!m.ready)return reject(new Error('Synthetic server did not start'));resolve({...m,process:next});});});
child=await launch();
const control=action=>new Promise((resolve,reject)=>{child.process.once('message',m=>m.error?reject(new Error(m.error)):resolve());child.process.send({action});});
const helper=http.createServer(async(req,res)=>{try{const expected='127.0.0.1:'+helper.address().port;if(req.headers.host!==expected||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!=='http://'+expected)){res.statusCode=403;res.end('Synthetic control origin rejected');return;}const action=new URL(req.url,'http://127.0.0.1').pathname;
 if(action==='/offline'||action==='/online'){await control(action.slice(1));res.end(`<p>${action.slice(1)}: synthetic application server</p>`);return;}
 if(action==='/restart'){const old=child;child=await launch();old.process.kill('SIGTERM');}
 if(action==='/'||action==='/launch'||action==='/restart'){
 const response=await fetch(child.origin+'/local/bootstrap',{headers:{'X-Banana-Bootstrap':child.bootstrap},redirect:'manual'});if(response.status!==303)throw new Error('Synthetic bootstrap failed');res.setHeader('Set-Cookie',response.headers.get('set-cookie'));res.statusCode=303;res.setHeader('Location',child.origin+'/');res.end();return;}
 res.end('<p>Synthetic acceptance controls: /launch /restart /offline /online</p>');
 }catch{res.statusCode=500;res.end('Synthetic control failed');}});
await new Promise(resolve=>helper.listen(0,'127.0.0.1',resolve));console.log(JSON.stringify({scenario,controlOrigin:'http://127.0.0.1:'+helper.address().port,appOrigin:child.origin}));
const stop=()=>{for(const c of all)c.kill('SIGTERM');helper.closeAllConnections();helper.close();};process.on('SIGINT',()=>{stop();setTimeout(()=>process.exit(),100);});process.on('SIGTERM',()=>{stop();setTimeout(()=>process.exit(),100);});
