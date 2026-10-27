import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_ROUTES, PROVIDER_KEYS, resolveProvider } from '../src/lib/providers.ts';
import { falSeedanceInput, openRouterSeedanceInput, seedanceProviderError } from '../src/lib/video/seedanceProviders.ts';
import { resizePixels } from '../src/lib/images/resizePixels.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({entryPoints:[fileURLToPath(new URL('../src/lib/images/imageEditPixels.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {compositeEditPixels} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { createMediaUploader } from '../desktop/server/uploads.mjs';

test('every key combination selects only a configured route for the same model',()=>{
  const providers=Object.keys(PROVIDER_KEYS);
  for(let mask=0;mask<32;mask++){
    const available=Object.fromEntries(providers.map((provider,index)=>[provider,!!(mask&(1<<index))]));
    for(const [model,routes] of Object.entries(MODEL_ROUTES)){
      const expected=routes.find(provider=>available[provider]);
      if(expected)assert.equal(resolveProvider(model,'auto',available),expected);
      else assert.throws(()=>resolveProvider(model,'auto',available),/key|keys/);
      for(const provider of providers){
        if(routes.includes(provider)&&available[provider])assert.equal(resolveProvider(model,provider,available),provider);
        else assert.throws(()=>resolveProvider(model,provider,available));
      }
    }
  }
  assert.throws(()=>resolveProvider('__proto__','auto',{fal:true}),/Unsupported/);
  assert.throws(()=>resolveProvider('anthropic/claude-opus-5.5','fal',{fal:true,openrouter:true}));
});
const request=(extra={})=>({videoModel:'seedance-2.5',mode:'image_to_video',prompt:'Move from @IMAGE_1 to @IMAGE_2.',duration:8,quality:'720p',aspectRatio:'adaptive',generateAudio:true,imageUrls:['https://example.invalid/first.png','https://example.invalid/last.png'],...extra});
test('first and last frames remain distinct in both video providers; reference mode remains separate',()=>{
  const body=request(),fal=falSeedanceInput(body),router=openRouterSeedanceInput({...body,aspectRatio:'16:9'});
  assert.equal(seedanceProviderError('fal',body),undefined);assert.equal(seedanceProviderError('openrouter',{...body,aspectRatio:'16:9'}),undefined);
  assert.equal(fal.endpoint,'bytedance/seedance-2.5/image-to-video');
  assert.equal(fal.input.image_url,body.imageUrls[0]);assert.equal(fal.input.end_image_url,body.imageUrls[1]);assert.equal(fal.input.aspect_ratio,'auto');assert.equal(fal.input.duration,'8');
  assert.deepEqual(router.frame_images.map(image=>image.frame_type),['first_frame','last_frame']);assert.equal(router.input_references,undefined);assert.equal(router.provider.allow_fallbacks,false);
  const reference=openRouterSeedanceInput(request({mode:'reference_to_video',aspectRatio:'16:9'}));assert.equal(reference.frame_images,undefined);assert.equal(reference.input_references.length,2);
});
test('provider-specific unsupported operations and values fail before submission',()=>{
  for(const extra of [{quality:'1080p'},{duration:-1},{mode:'video_edit',videoUrls:['https://example.invalid/source.mp4']},{audioUrls:['https://example.invalid/audio.mp3']},{mode:'reference_to_video',aspectRatio:'adaptive'}])assert.ok(seedanceProviderError('openrouter',request(extra)));
  assert.equal(seedanceProviderError('fal',request({duration:-1,quality:'1080p'})),undefined);
  assert.ok(seedanceProviderError('fal',request({imageUrls:Array(3).fill('https://example.invalid/x')})));
  assert.ok(seedanceProviderError('fal',request({duration:31})));
  const edit=falSeedanceInput(request({mode:'video_edit',videoUrls:['https://example.invalid/source.mp4'],prompt:'Edit @VIDEO_1 using @IMAGE_1 and @AUDIO_1.'}));
  assert.equal(edit.input.task,'editing');assert.equal(edit.input.duration,'auto');assert.equal(edit.input.aspect_ratio,'auto');assert.match(edit.input.prompt,/@Video1.*@Image1.*@Audio1/);
});
test('resizing a generated tier cannot change any source pixel outside selected layers',()=>{
  const source=new Uint8Array(12*12*4);for(let i=0;i<source.length;i++)source[i]=i%256;
  const small=new Uint8Array(6*6*4).fill(210),resized=resizePixels(small,6,6,12,12);
  const region={x:.25,y:.25,width:.5,height:.5};
  const result=compositeEditPixels(source,resized,12,12,region);
  for(let y=0;y<12;y++)for(let x=0;x<12;x++)if(x<3||x>=9||y<3||y>=9){const i=(y*12+x)*4;assert.deepEqual(Array.from(result.slice(i,i+4)),Array.from(source.slice(i,i+4)));}
  assert.equal(result[(6*12+6)*4],210);
});
test('native route preferences survive restart and cannot select a foreign model/provider pair',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-routing-'));let store=new LocalWorkspace(directory);
  try{
    assert.equal(store.rpc('save_provider_preference',{p_model:'seedance-2.5',p_provider:'fal'},false),true);
    assert.throws(()=>store.rpc('save_provider_preference',{p_model:'minimax-h3',p_provider:'evolink'},false));
    store.close();store=new LocalWorkspace(directory);
    assert.deepEqual(store.rpc('get_provider_preferences',{},false),{'seedance-2.5':'fal'});
  }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('OpenRouter local frame uploads use bytes without requiring an EvoLink or fal.ai key',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-router-upload-')),store=new LocalWorkspace(directory);
  try{
    store.origin='http://127.0.0.1:12345';await store.upload('refs/frame.png',Buffer.from('synthetic'));
    const prepare=createMediaUploader(store,{fetchImpl:()=>{throw new Error('Unexpected external upload');}});
    const result=await prepare('openrouter',{imageUrls:[store.mediaUrl('refs/frame.png')]});
    assert.equal(result.imageUrls[0],'data:image/png;base64,'+Buffer.from('synthetic').toString('base64'));
  }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('subscription CLI routes serve only their own text model and rank after every API-key route',()=>{
  assert.deepEqual(MODEL_ROUTES['anthropic/claude-opus-5.5'],['openrouter','claude-cli']);
  assert.equal(MODEL_ROUTES['gpt-6.1-sol'].at(-1),'codex-cli');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5','auto',{'claude-cli':true}),'claude-cli');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5','auto',{openrouter:true,'claude-cli':true}),'openrouter');
  assert.equal(resolveProvider('gpt-6.1-sol','codex-cli',{'codex-cli':true,openai:true}),'codex-cli');
  assert.throws(()=>resolveProvider('anthropic/claude-opus-5.5','codex-cli',{'codex-cli':true}));
  assert.throws(()=>resolveProvider('gpt-image-2.5-sunburst','auto',{'claude-cli':true,'codex-cli':true}));
  assert.throws(()=>resolveProvider('gemini-3.8-flash','claude-cli',{'claude-cli':true}));
});
