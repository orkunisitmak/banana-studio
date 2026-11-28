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
 assert.equal((await fetch(origin+'/api/gemini-status')).status,401);
 assert.equal((await fetch(origin+'/api/evolink-generate',{method:'POST',headers:{...headers,Origin:'https://example.invalid'},body:'{}'})).status,403);
 const setRoute=async(model,provider)=>{
  const result=await post('/local/query',{rpc:'save_provider_preference',args:{p_expected_user_id:config.userId,p_model:model,p_provider:provider}});
  assert.equal(result.body.error,null,JSON.stringify(result.body));assert.equal(result.body.data,true);
 };
 const sourcePath=config.userId+'/refs/synthetic-source.png';
 const upload=await fetch(origin+'/local/upload',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'image/png','X-Media-Path':encodeURIComponent(sourcePath)},body:sourcePNG});assert.equal(upload.status,200);
 const sourceURL=origin+'/storage/v1/object/authenticated/media/'+sourcePath;
 const references=[{id:'gallery-synthetic-source',data:sourceURL,mimeType:'image/png'}];
 const keys={openai:'OPENAI_API_KEY',openrouter:'OPENROUTER_API_KEY',fal:'FAL_KEY',gemini:'GEMINI_API_KEY',evolink:'EVOLINK_API_KEY'};
 const combinations=[
  ['fal','gpt-image-2.6-sunburst'],['openai','gpt-image-2.6-sunburst'],
  ...['gpt-image-2.5-sunburst','gemini-3-pro-image-preview','gemini-nano-banana-2.1'].flatMap(model=>
   ['fal','openrouter',model.startsWith('gpt-')?'openai':'gemini'].map(provider=>[provider,model])),
 ];
 const setKeys=async(...providers)=>{
  child.stdin.write(JSON.stringify({action:'keys',keys:Object.fromEntries(providers.map(provider=>[keys[provider],'integration-test-only-value']))})+'\n');
  for(let i=0;i<100;i++){const status=await(await fetch(origin+'/api/gemini-status',{headers:{Cookie:cookie}})).json();if(Object.entries(status.providers).every(([provider,enabled])=>enabled===providers.includes(provider)))return;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Provider key update did not become ready.');
 };
 const readRow=async id=>{
  const until=Date.now()+30_000;
  while(Date.now()<until){const result=await post('/local/query',{table:'generations',operation:'select',columns:'*',filters:[{column:'id',operator:'eq',value:id}],single:true});const row=result.body.data;if(['completed','failed'].includes(row?.status))return row;await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('The local image job did not complete.');
 };
 // A missing default fal key must not spend the configured OpenAI key.
 const unavailable=await post('/api/openai-image-enqueue',{id:'no-default-key',model:'gpt-image-2.6-sunburst',prompt:'Default provider unavailable.',aspectRatio:'1:1',resolution:'1K'});
 assert.equal(unavailable.status,503,JSON.stringify(unavailable.body));
 for(const [index,[provider,model]] of combinations.entries())for(const protectedEdit of [true,false]) {
  await setKeys(provider);
  if(index!==0)await setRoute(model,'auto'); // Explicit Auto still works with a single configured service.
  const id='synthetic-image-'+index+'-'+protectedEdit;
  const refs=references.map(ref=>({...ref,isEditSource:protectedEdit,...(protectedEdit?{editRegion:{x:.25,y:.25,width:.5,height:.5}}:{})}));
  const submitted=await post('/api/openai-image-enqueue',{id,model,prompt:protectedEdit?'Change the selected object to blue.':'Create a completely new scene inspired by the reference.',aspectRatio:'1:1',resolution:'1K',imageOperation:protectedEdit?'edit':'generate',referenceImages:refs,options:{quality:'auto',background:'opaque',outputFormat:'png',moderation:'auto'}});
  assert.equal(submitted.status,202,JSON.stringify(submitted.body));
  const row=await readRow(id);assert.equal(row.metadata.generationProvider,provider);assert.equal(row.metadata.imageGenerationPrompt.includes('LOCAL IMAGE EDIT'),protectedEdit);
  assert.equal(row?.status,'completed',row?.metadata?.error||'The local image job did not complete.');
  const result=await fetch(origin+'/storage/v1/object/authenticated/media/'+row.storage_path,{headers:{Cookie:cookie}});assert.equal(result.status,200);
  const decoded=Buffer.from(codec({operation:'decode',data:Buffer.from(await result.arrayBuffer()).toString('base64')}).data,'base64');
  if(protectedEdit){let outside=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){if(x>=256&&x<768&&y>=256&&y<768)continue;const i=(y*width+x)*4;assert.ok(decoded.subarray(i,i+4).equals(sourcePixels.subarray(i,i+4)));outside++;}assert.ok(decoded.subarray((512*width+512)*4,(512*width+512)*4+4).equals(generatedPixels.subarray(0,4)));console.log(`${provider}/${model}: preserved ${outside} outside pixels exactly.`);}
  else {assert.ok(decoded.equals(generatedPixels));assert.equal(row.metadata.imageEditProtection,undefined);}
 }
 await setKeys('fal');
 const seedream=await post('/api/openai-image-enqueue',{id:'synthetic-seedream-edit',model:'seedream-5.5',prompt:'Create two synthetic variations.',aspectRatio:'1:1',resolution:'1K',referenceImages:references,seedreamOptions:{mode:'edit',numImages:2}});
 assert.equal(seedream.status,202,JSON.stringify(seedream.body));
 const archived=await readRow('synthetic-seedream-edit');
 assert.equal(archived.status,'completed',archived.metadata?.error);
 const outputs=archived.metadata.seedreamResult.images;
 assert.equal(outputs.length,2);assert.notEqual(outputs[0].url,outputs[1].url);
 for(const image of outputs){
  const location=new URL(image.url);assert.equal(location.origin,origin);
  assert.ok(location.pathname.startsWith('/storage/v1/object/authenticated/media/'+config.userId+'/seedream/'));
  assert.equal((await fetch(location)).status,401);
  const saved=await fetch(location,{headers:{Cookie:cookie}});assert.equal(saved.status,200);assert.ok(providerPNG.equals(Buffer.from(await saved.arrayBuffer())));
 }
 // An ambiguous submission cannot be retried on another configured service.
 await setKeys('openai','openrouter');await setRoute('gpt-image-2.5-sunburst','openai');
 const failed=await post('/api/openai-image-enqueue',{id:'synthetic-uncertain',model:'gpt-image-2.5-sunburst',prompt:'[simulate-uncertain]',aspectRatio:'1:1',resolution:'1K'});
 assert.equal(failed.status,202);
 const original=await readRow('synthetic-uncertain');
 assert.equal(original.status,'failed');assert.equal(original.metadata.generationProvider,'openai');
 await setRoute('gpt-image-2.5-sunburst','openrouter');
 const duplicate=await post('/api/openai-image-enqueue',{id:'synthetic-uncertain',model:'gpt-image-2.5-sunburst',provider:'openrouter',prompt:'Do not resubmit',aspectRatio:'1:1',resolution:'1K'});
 // Both SQLite and PostgreSQL acknowledge the owner's existing job; neither replaces its payload.
 assert.equal(duplicate.status,202,JSON.stringify(duplicate.body));assert.deepEqual(duplicate.body,failed.body);
 assert.deepEqual(await readRow('synthetic-uncertain'),original);
 const textModels=['claude-opus-5.5','gpt-6.2-sol','gemini-4-hydrogen'];
 for(const provider of ['fal','openrouter']){
  await setKeys(provider);
  for(const model of textModels){
   if(provider!=='fal')await setRoute(model,provider);
   const result=await post('/api/openrouter-text-generate',{model,provider,reasoningEffort:'medium',contents:{parts:[{text:'Write five distinct ideas.'}]},usageContext:{action:'brainstorm',prompt:'Synthetic brainstorm'},brainstormCount:5});
   assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(JSON.parse(result.body.text).length,5);
  }
 }
 // Footage must stay native even with an explicit OpenRouter creative route.
 await setKeys('gemini','openrouter');
 const footage='https://www.youtube.com/watch?v=abcdefghijk';
 const analysis=await post('/api/gemini-generate',{model:'gemini-4-hydrogen',contents:{parts:[{fileData:{fileUri:footage}},{text:'Describe a visible event.'}]},config:{thinkingConfig:{thinkingLevel:'HIGH'},mediaResolution:'MEDIA_RESOLUTION_LOW'}});
 assert.equal(analysis.status,200,JSON.stringify(analysis.body));assert.equal(analysis.body.text,'Synthetic footage observation.');
 for(const [model,provider] of [['seedance-2.0','fal'],['seedance-2.5','fal'],['seedance-2.5','openrouter']]){
  await setKeys(provider);await setRoute(model,provider);
  const result=await post('/api/seedance-video',{videoModel:model,mode:'image_to_video',prompt:'A transition between first and last frames.',duration:8,quality:'720p',aspectRatio:provider==='openrouter'?'16:9':'adaptive',imageUrls:['https://example.invalid/first.png','https://example.invalid/last.png']});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.provider,provider);
  await setRoute(model,'off'); // Switching off stops new work, not recovery.
  const status=await(await fetch(origin+'/api/seedance-video?taskId='+encodeURIComponent(result.body.taskId),{headers:{Cookie:cookie}})).json();assert.equal(status.status,'SUCCEEDED');
  const foreign=await fetch(origin+'/api/seedance-video?taskId='+encodeURIComponent(result.body.taskId.replace('synthetic-video','unowned-task')),{headers:{Cookie:cookie}});assert.equal(foreign.status,404);
 }
 for(const [model,provider,endpoint,mode,settings] of [
  ['gemini-omni-1.2-flash','fal','fal-h3-video','text_to_video',{resolution:'720p',duration:5,aspectRatio:'16:9'}],
  ['minimax-h3','evolink','evolink-generate','text_only',{quality:'768p'}],
  ['magi-2','evolink','evolink-generate','text_only',{quality:'1080p'}],
 ]){
  await setKeys(provider);await setRoute(model,provider);
  const request={videoModel:model,mode,prompt:'Synthetic video scene.',...settings};
  if(provider==='fal'){
   request.generationId='lost-ack-omni';
   const saved=await post('/local/query',{table:'generations',operation:'insert',value:{id:request.generationId,type:'video',status:'pending',metadata:{videoModel:model,generationProvider:provider}}});
   assert.equal(saved.body.error,null,JSON.stringify(saved.body));
  }
  const submission=await post('/api/'+endpoint,request);
  assert.equal(submission.status,200,JSON.stringify(submission.body));
  await setRoute(model,'off');
  if(provider==='fal'){
   // Simulate a lost acknowledgement, a removed key and an unavailable original local reference.
   await setKeys();
   const lookup={videoModel:model,generationId:request.generationId,imageUrls:[sourceURL+'.missing']};
   const recovered=await post('/api/'+endpoint,lookup);
   assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.deepEqual(recovered.body,submission.body);
   assert.equal((await post('/api/'+endpoint,{...lookup,videoModel:'minimax-h3'})).status,409);
   assert.equal((await post('/api/'+endpoint,{...lookup,generationId:'unowned-generation'})).status,404);
   assert.equal((await fetch(origin+'/api/'+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(lookup)})).status,401);
   await setKeys(provider);
  }
  assert.equal((await post('/api/'+endpoint,{...request,generationId:undefined})).status,403);
  const poll=provider==='evolink'?'/api/evolink-status?taskId='+encodeURIComponent(submission.body.taskId)
   :'/api/fal-h3-video?'+new URLSearchParams({requestId:submission.body.taskId,endpoint:submission.body.queueEndpoint});
  const status=await(await fetch(origin+poll,{headers:{Cookie:cookie}})).json();assert.equal(status.status,'SUCCEEDED',JSON.stringify(status));
 }
 const calls=fs.readFileSync(path.join(root,'provider-calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse),imageCalls=calls.filter(call=>call.kind==='image');
 assert.equal(imageCalls.length,combinations.length*2+1,'A repeated generation ID must not submit a second image request.');
 const uncertainCalls=imageCalls.filter(call=>call.uncertain);
 assert.equal(uncertainCalls.length,1);assert.equal(new URL(uncertainCalls[0].target).hostname,'api.openai.com');
 assert.ok(imageCalls.filter(call=>!call.uncertain).every(call=>call.hasDataURL));assert.ok(calls.every(call=>!call.hasCookie));
 const submits=calls.filter(call=>call.kind==='seedream'&&call.method==='POST');
 assert.equal(submits.length,1);assert.equal(submits[0].target,'/bytedance/seedream/v5.5/edit');assert.equal(submits[0].numImages,2);assert.ok(submits[0].hasDataURL);
 const textCalls=calls.filter(call=>call.kind==='text'),upstreamModels=['anthropic/'+textModels[0],'openai/'+textModels[1],'google/'+textModels[2]];
 assert.deepEqual(textCalls.map(call=>call.input.model),[...upstreamModels,...upstreamModels]);assert.deepEqual(textCalls.map(call=>new URL(call.target).hostname),['fal.run','fal.run','fal.run','openrouter.ai','openrouter.ai','openrouter.ai']);
 assert.ok(textCalls.every(call=>call.input.provider.allow_fallbacks===false));
 const footageCalls=calls.filter(call=>call.kind==='footage');assert.equal(footageCalls.length,1);
 assert.equal(footageCalls[0].input.contents[0].parts[0].fileData.fileUri,footage);
 const videos=calls.filter(call=>call.kind==='video'&&call.method==='POST');assert.equal(videos.length,6);
 assert.deepEqual(videos.filter(call=>new URL(call.target).hostname==='api.evolink.ai').map(call=>call.input.model),['minimax-h3-max-text-to-video','magi-2-text-to-video']);
 console.log('Local model defaults, explicit provider choices, exact brainstorm batches, native footage analysis, owned recovery and no paid fallback passed.');
 console.log('Packaged app → local queue → mock provider → local gallery flow passed. No paid provider was contacted.');
} catch(error){console.error(error.message);process.exitCode=1;}
finally {if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}fs.rmSync(root,{recursive:true,force:true});}
