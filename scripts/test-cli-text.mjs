// Opt-in check of the subscription (CLI) text route against the real, signed-in
// `claude` / `codex` commands. Not part of `npm test`: it spends subscription quota.
// Usage: node scripts/test-cli-text.mjs [claude-cli|codex-cli ...]
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

const root=path.resolve(import.meta.dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'banana-cli-test-'));
const replacements={auth:'auth.mjs',openaiGuard:'guard.mjs',imageJobQueue:'queue.mjs',providerMedia:'providerMedia.mjs',rasterCodec:'rasterCodec.mjs'};
const server=path.join(tmp,'server.mjs');
await build({entryPoints:[path.join(root,'desktop/server/main.mjs')],outfile:server,platform:'node',target:'node24',format:'esm',banner:{js:"import { createRequire as __bananaCreateRequire } from 'node:module'; const require = __bananaCreateRequire(import.meta.url);"},bundle:true,packages:'bundle',external:['sharp'],logLevel:'error',plugins:[{name:'local-workspace-boundary',setup(b){b.onResolve({filter:/(auth|openaiGuard|imageJobQueue|providerMedia|rasterCodec)\.(js|ts)$/},args=>{
  const resolved=path.resolve(args.resolveDir,args.path);if(path.dirname(resolved)!==path.join(root,'api/_lib'))return;
  return {path:path.join(root,'desktop/server',replacements[path.basename(args.path).replace(/\.(js|ts)$/,'')])};});}}]});
fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'junction');
const bootstrap=randomBytes(32).toString('hex');
const child=spawn(process.execPath,[server],{cwd:tmp,env:{...process.env},stdio:['pipe','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
child.stdin.write(JSON.stringify({dataDirectory:path.join(tmp,'workspace'),webRoot:tmp,bootstrap,keys:{}})+'\n');
try{
  let ready;for(let i=0;i<300&&!ready;i++){ready=output.split('\n').map(l=>{try{return JSON.parse(l);}catch{return null;}}).find(v=>v?.event==='ready');if(!ready)await new Promise(r=>setTimeout(r,50));}
  assert.ok(ready,'server did not start:\n'+output.slice(0,2000));
  const origin=ready.origin;
  const init=await fetch(origin+'/local/bootstrap',{headers:{'X-Banana-Bootstrap':bootstrap},redirect:'manual'}),cookie=init.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
  const post=async(route,value)=>{const r=await fetch(origin+route,{method:'POST',headers,body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
  const status=await(await fetch(origin+'/api/gemini-status',{headers:{Cookie:cookie}})).json();
  console.log('availability',status.providers);
  const models={'claude-cli':'anthropic/claude-opus-5.5','codex-cli':'gpt-6.1-sol'};
  const wanted=process.argv.slice(2).length?process.argv.slice(2):Object.keys(models);
  for(const cliProvider of wanted){
    assert.ok(status.providers[cliProvider],cliProvider+' is not available on this machine');
    const base={cliProvider,model:models[cliProvider],reasoningEffort:'low'};
    const t=Date.now();
    const plain=await post('/api/cli-text-generate',{...base,contents:{parts:[{text:'Rewrite as one detailed image prompt: a robot painting a sunset.'}]},usageContext:{action:'enhance',prompt:'test'}});
    assert.equal(plain.status,200,JSON.stringify(plain.body));assert.ok(plain.body.text.length>40);
    const brainstorm=await post('/api/cli-text-generate',{...base,contents:{parts:[{text:'Brief: a cover about coding with AI.'}]},usageContext:{action:'brainstorm',prompt:'test'},brainstormCount:3});
    assert.equal(brainstorm.status,200,JSON.stringify(brainstorm.body));assert.equal(JSON.parse(brainstorm.body.text).length,3);
    // A real, solid red PNG as the reference image.
    const png=(await sharp({create:{width:64,height:64,channels:3,background:'#e00000'}}).png().toBuffer()).toString('base64');
    const withImage=await post('/api/cli-text-generate',{...base,contents:{parts:[{text:'Name the dominant colour of the attached reference in one word.'},{inlineData:{mimeType:'image/png',data:png}}]},usageContext:{action:'enhance',prompt:'test'}});
    assert.equal(withImage.status,200,JSON.stringify(withImage.body));assert.match(withImage.body.text,/red|crimson|scarlet|kırmızı/i);
    console.log(cliProvider,'ok',Date.now()-t,'ms; image answer:',withImage.body.text.slice(0,120));
  }
  const bad=await post('/api/cli-text-generate',{cliProvider:'claude-cli',model:'gpt-6.1-sol',contents:{parts:[{text:'x'}]},usageContext:{action:'enhance',prompt:'x'}});
  assert.equal(bad.status,400);
  console.log('all checks passed');
}finally{child.kill();try{fs.rmdirSync(path.join(tmp,'node_modules'));fs.rmSync(tmp,{recursive:true,force:true});}catch{ /* the OS temp cleaner takes it */ }}
