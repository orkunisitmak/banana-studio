import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const windows=process.platform==='win32';
const app=path.resolve(process.argv[2]||(windows?'.build/staging-windows/Banana Studio':'.build/staging/Banana Studio.app'));
const resources=windows?app:path.join(app,'Contents/Resources'),executable=path.join(app,'Contents/MacOS/BananaStudio');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'banana-generation-test-'));
const runtime=path.join(resources,windows?'runtime/node.exe':'runtime/node');
const runtimeEnv=windows?Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])):{PATH:'/usr/bin:/bin'};
// Keep a developer's own Codex sign-in out of the mocked provider matrix.
runtimeEnv.CODEX_ENABLED='false';
const codecFile=path.join(root,'codec.mjs');
if(windows)fs.writeFileSync(codecFile,`import {createRequire} from 'node:module';const sharp=createRequire(${JSON.stringify(pathToFileURL(path.join(resources,'workspace/package.json')).href)})('sharp');\nlet raw='';for await(const part of process.stdin)raw+=part;const input=JSON.parse(raw),bytes=Buffer.from(input.data,'base64');\nif(input.operation==='decode'){const {data,info}=await sharp(bytes).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});process.stdout.write(JSON.stringify({data:data.toString('base64'),width:info.width,height:info.height}));}else{const data=await sharp(bytes,{raw:{width:input.width,height:input.height,channels:4}}).png().toBuffer();process.stdout.write(JSON.stringify({data:data.toString('base64')}));}`);
const codec=input=>JSON.parse(execFileSync(windows?runtime:executable,windows?[codecFile]:['--raster-codec'],{input:JSON.stringify(input),maxBuffer:200*1024*1024,timeout:30_000,env:runtimeEnv}));
let child,output='',diagnostics='';
try {
 const width=1024,height=1024,sourcePixels=Buffer.alloc(width*height*4),generatedPixels=Buffer.alloc(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;sourcePixels.set([x%256,y%256,127,255],i);generatedPixels.set([17,83,191,255],i);}
 const encode=pixels=>Buffer.from(codec({operation:'encode',data:pixels.toString('base64'),width,height}).data,'base64');
 const sourcePNG=encode(sourcePixels),providerPNG=encode(generatedPixels);fs.writeFileSync(path.join(root,'provider.png'),providerPNG,{mode:0o600});
 const preload=path.join(root,'mock-provider.mjs');
 fs.copyFileSync(new URL('./provider-test-preload.mjs',import.meta.url),preload);runtimeEnv.BANANA_TEST_ROOT=root;
 const bootstrap=randomBytes(32).toString('hex');
 child=spawn(runtime,['--import',pathToFileURL(preload).href,path.join(resources,'workspace/server.mjs')],{cwd:path.join(resources,'workspace'),env:runtimeEnv,stdio:['pipe','pipe','pipe']});
 child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>diagnostics+=data);
 child.stdin.write(JSON.stringify({dataDirectory:path.join(root,'workspace'),webRoot:path.join(resources,'workspace/web'),bootstrap,keys:{OPENAI_API_KEY:'integration-test-only-value'}})+'\n');
 let ready;const deadline=Date.now()+15_000;
 while(Date.now()<deadline&&!ready&&child.exitCode===null){ready=output.split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(v=>v?.event==='ready');if(!ready)await new Promise(resolve=>setTimeout(resolve,50));}
 // Only this isolated synthetic child has diagnostics surfaced. Its provider
 // is mocked and its environment/data directory contain no user credentials.
 if(!ready&&diagnostics)console.error(diagnostics.slice(0,4000));
 assert.ok(ready,'Packaged local server did not become ready.');
 const origin=ready.origin;
 const init=await fetch(origin+'/local/bootstrap',{headers:{'X-Banana-Bootstrap':bootstrap},redirect:'manual'}),cookie=init.headers.get('set-cookie').split(';')[0];
 const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
 const post=async(route,value)=>{const r=await fetch(origin+route,{method:'POST',headers,body:JSON.stringify(value)});return {status:r.status,body:await r.json()};};
 const config=await(await fetch(origin+'/api/workspace-config',{headers:{Cookie:cookie}})).json();
 const sourcePath=config.userId+'/refs/synthetic-source.png';
 const upload=await fetch(origin+'/local/upload',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'image/png','X-Media-Path':encodeURIComponent(sourcePath)},body:sourcePNG});assert.equal(upload.status,200);
 const sourceURL=origin+'/storage/v1/object/authenticated/media/'+sourcePath;
 const references=[{id:'gallery-synthetic-source',data:sourceURL,mimeType:'image/png'}];
 const combinations=[['openai','OPENAI_API_KEY','gpt-image-2.5-sunburst'],['openrouter','OPENROUTER_API_KEY','gpt-image-2.5-sunburst'],['openrouter','OPENROUTER_API_KEY','gemini-3-pro-image-preview'],['openrouter','OPENROUTER_API_KEY','gemini-nano-banana-2.1'],['fal','FAL_KEY','gpt-image-2.5-sunburst'],['fal','FAL_KEY','gemini-3-pro-image-preview'],['fal','FAL_KEY','gemini-nano-banana-2.1'],['gemini','GEMINI_API_KEY','gemini-3-pro-image-preview'],['gemini','GEMINI_API_KEY','gemini-nano-banana-2.1']];
 const setKeys=async keys=>{
  child.stdin.write(JSON.stringify({action:'keys',keys})+'\n');
  for(let i=0;i<100;i++){const status=await(await fetch(origin+'/api/gemini-status',{headers:{Cookie:cookie}})).json();if(Object.entries(status.providers).every(([provider,enabled])=>enabled===Object.hasOwn(keys,{openai:'OPENAI_API_KEY',openrouter:'OPENROUTER_API_KEY',fal:'FAL_KEY',gemini:'GEMINI_API_KEY',evolink:'EVOLINK_API_KEY'}[provider])))return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Provider key update did not become ready.');
 };
 const readRow=async id=>{
  const until=Date.now()+30_000;
  while(Date.now()<until){const result=await post('/local/query',{table:'generations',operation:'select',columns:'*',filters:[{column:'id',operator:'eq',value:id}],single:true});const row=result.body.data;if(['completed','failed'].includes(row?.status))return row;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('The local image job did not complete.');
 };
 for(const [index,[provider,key,model]] of combinations.entries())for(const protectedEdit of [true,false]) {
  await setKeys({[key]:'integration-test-only-value'});
  const id='synthetic-image-'+index+'-'+protectedEdit;
  const refs=references.map(ref=>({...ref,isEditSource:protectedEdit,...(protectedEdit?{editRegion:{x:.25,y:.25,width:.5,height:.5}}:{})}));
  const submitted=await post('/api/openai-image-enqueue',{id,model,prompt:protectedEdit?'Change the selected object to blue.':'Create a completely new scene inspired by the reference.',aspectRatio:'1:1',resolution:'1K',referenceImages:refs,options:{quality:'auto',background:'opaque',outputFormat:'png',moderation:'auto'}});
  assert.equal(submitted.status,202,JSON.stringify(submitted.body));
  const row=await readRow(id);assert.equal(row.metadata.generationProvider,provider);assert.equal(row.metadata.imageGenerationPrompt.includes('LOCAL IMAGE EDIT'),protectedEdit);
  assert.equal(row?.status,'completed',row?.metadata?.error||'The local image job did not complete.');
  const result=await fetch(origin+'/storage/v1/object/authenticated/media/'+row.storage_path,{headers:{Cookie:cookie}});assert.equal(result.status,200);
  const decoded=Buffer.from(codec({operation:'decode',data:Buffer.from(await result.arrayBuffer()).toString('base64')}).data,'base64');
  if(protectedEdit){let outside=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(x>=256&&x<768&&y>=256&&y<768)continue;const i=(y*width+x)*4;assert.ok(decoded.subarray(i,i+4).equals(sourcePixels.subarray(i,i+4)));outside++;}assert.ok(decoded.subarray((512*width+512)*4,(512*width+512)*4+4).equals(generatedPixels.subarray(0,4)));console.log(`${provider}/${model}: preserved ${outside} outside pixels exactly.`);}
  else {assert.ok(decoded.equals(generatedPixels));assert.equal(row.metadata.imageEditProtection,undefined);}
 }
 // An ambiguous submission cannot be retried on another configured service.
 await setKeys({OPENAI_API_KEY:'integration-test-only-value',OPENROUTER_API_KEY:'integration-test-only-value'});
 const failed=await post('/api/openai-image-enqueue',{id:'synthetic-uncertain',model:'gpt-image-2.5-sunburst',prompt:'[simulate-uncertain]',aspectRatio:'1:1',resolution:'1K'});assert.equal(failed.status,202);assert.equal((await readRow('synthetic-uncertain')).status,'failed');
 await post('/api/openai-image-enqueue',{id:'synthetic-uncertain',model:'gpt-image-2.5-sunburst',provider:'openrouter',prompt:'Do not resubmit',aspectRatio:'1:1',resolution:'1K'});
 await setKeys({OPENROUTER_API_KEY:'integration-test-only-value'});
 for(const model of ['anthropic/claude-opus-5.5','gpt-6.1-sol','gemini-3.8-flash']){
  const result=await post('/api/openrouter-text-generate',{model,reasoningEffort:'medium',contents:{parts:[{text:'Write five distinct ideas.'}]},usageContext:{action:'brainstorm',prompt:'Synthetic brainstorm'},brainstormCount:5});
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(JSON.parse(result.body.text).length,5);
 }
 const analysis=await post('/api/openrouter-text-generate',{model:'gemini-3.8-flash',reasoningEffort:'low',contents:{parts:[{fileData:{fileUri:'https://www.youtube.com/watch?v=abcdefghijk'}},{text:'Analyze the actual supplied video.'}]},usageContext:{action:'enhance',prompt:'[youtube-video-brief]'},outputFormat:'youtube_analysis'});assert.equal(analysis.status,200,JSON.stringify(analysis.body));
 for(const [provider,key] of [['fal','FAL_KEY'],['openrouter','OPENROUTER_API_KEY']]){
  await setKeys({[key]:'integration-test-only-value'});
  const result=await post('/api/seedance-video',{videoModel:'seedance-2.5',mode:'image_to_video',prompt:'A transition between first and last frames.',duration:8,quality:'720p',aspectRatio:provider==='openrouter'?'16:9':'adaptive',imageUrls:['https://example.invalid/first.png','https://example.invalid/last.png']});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.provider,provider);
  const status=await(await fetch(origin+'/api/seedance-video?taskId='+encodeURIComponent(result.body.taskId),{headers:{Cookie:cookie}})).json();assert.equal(status.status,'SUCCEEDED');
  const foreign=await fetch(origin+'/api/seedance-video?taskId='+encodeURIComponent(result.body.taskId.replace('synthetic-video','unowned-task')),{headers:{Cookie:cookie}});assert.equal(foreign.status,404);
 }
 const calls=fs.readFileSync(path.join(root,'provider-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse),imageCalls=calls.filter(call=>call.kind==='image');assert.equal(imageCalls.length,19);assert.ok(imageCalls.filter(call=>!String(call.input.prompt).includes('[simulate-uncertain]')).every(call=>call.hasDataURL));assert.ok(calls.every(call=>!call.hasCookie));
 const textCalls=calls.filter(call=>call.kind==='text');assert.deepEqual(textCalls.slice(0,3).map(call=>call.input.model),['anthropic/claude-opus-5.5','openai/gpt-6.1-sol','google/gemini-3.8-flash']);assert.deepEqual(textCalls[3].input.provider.only,['google-ai-studio']);assert.ok(textCalls[3].input.messages[1].content.some(part=>part.type==='video_url'));assert.ok(textCalls.every(call=>call.input.provider.allow_fallbacks===false));
 assert.ok(!calls.some(call=>call.target?.includes('evolink')));console.log('Single-key routes, exact five-idea batches, footage input, task ownership and no paid fallback passed.');
 console.log('Packaged app → local queue → mock provider → local gallery flow passed. No paid provider was contacted.');
} catch(error){console.error(error.message);process.exitCode=1;}
finally {if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}fs.rmSync(root,{recursive:true,force:true});}
