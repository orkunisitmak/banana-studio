import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { createMediaUploader } from '../desktop/server/uploads.mjs';

test('local fal references are uploaded once, while prompts and stored rows stay local',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-uploads-')),store=new LocalWorkspace(directory),old=process.env.FAL_KEY;process.env.FAL_KEY='synthetic-test-value';
 try {
  store.origin='http://127.0.0.1:12345';await store.upload('refs/example.png',Buffer.from('synthetic'));
  const local=store.mediaUrl('refs/example.png');let calls=0;
  const prepare=createMediaUploader(store,{falUpload:async file=>{calls++;assert.equal(file.type,'image/png');assert.ok(!file.name.includes('example'));return 'https://example.invalid/provider-reference.png';}});
  const input={prompt:local,input:{image_urls:[local,local]},options:{startImageUrl:local}};
  const result=await prepare('fal',input);assert.equal(result.prompt,local);assert.deepEqual(result.input.image_urls,['https://example.invalid/provider-reference.png','https://example.invalid/provider-reference.png']);assert.equal(calls,1);assert.equal(input.input.image_urls[0],local);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});if(old===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=old;}
});
test('EvoLink receives multipart bytes at its fixed upload endpoint; loopback credentials are never forwarded',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-uploads-')),store=new LocalWorkspace(directory),old=process.env.EVOLINK_API_KEY;process.env.EVOLINK_API_KEY='synthetic-test-value';
 try{
  store.origin='http://127.0.0.1:12345';await store.upload('refs/video.mp4',Buffer.from('synthetic video'));
  const prepare=createMediaUploader(store,{fetchImpl:async(url,options)=>{assert.equal(url,'https://files-api.evolink.ai/api/v1/files/upload/stream');assert.equal(options.redirect,'error');assert.equal(options.headers.Cookie,undefined);assert.equal(options.body.get('file').type,'video/mp4');return new Response(JSON.stringify({success:true,data:{file_url:'https://example.invalid/reference.mp4'}}),{headers:{'Content-Type':'application/json'}});}});
  const result=await prepare('evolink',{videoUrls:[store.mediaUrl('refs/video.mp4')]});assert.deepEqual(result.videoUrls,['https://example.invalid/reference.mp4']);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});if(old===undefined)delete process.env.EVOLINK_API_KEY;else process.env.EVOLINK_API_KEY=old;}
});
test('missing provider keys and size limits reach the user before any upload is attempted',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-uploads-')),store=new LocalWorkspace(directory),old=process.env.FAL_KEY,oldEvolink=process.env.EVOLINK_API_KEY;
 try{
  store.origin='http://127.0.0.1:12345';await store.upload('refs/example.png',Buffer.from('synthetic'));
  fs.writeFileSync(store.mediaPath('refs/large.mp4'),'');fs.truncateSync(store.mediaPath('refs/large.mp4'),100*1024*1024+1);
  let calls=0;const prepare=createMediaUploader(store,{falUpload:async()=>{calls++;throw new Error('upstream detail');},fetchImpl:async()=>{calls++;throw new Error('upstream detail');}});
  delete process.env.FAL_KEY;await assert.rejects(prepare('fal',{image_url:store.mediaUrl('refs/example.png')}),{message:'Add your fal.ai key in Provider keys before using this reference.'});
  process.env.EVOLINK_API_KEY='synthetic-test-value';await assert.rejects(prepare('evolink',{videoUrls:[store.mediaUrl('refs/large.mp4')]}),{message:'The reference exceeds the 100 MB provider upload limit.'});
  assert.equal(calls,0);
  process.env.FAL_KEY='synthetic-test-value';await assert.rejects(prepare('fal',{image_url:store.mediaUrl('refs/example.png')}),{message:'The provider could not prepare this reference. No generation was submitted.'});
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});if(old===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=old;if(oldEvolink===undefined)delete process.env.EVOLINK_API_KEY;else process.env.EVOLINK_API_KEY=oldEvolink;}
});
