import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const stubs={
  authService:'export const logUsage=async()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:"synthetic-user"},access_token:"synthetic-token"}}})}};',
  providerRouting:'export const selectProvider=async()=>globalThis.__videoProvider;',
  storageService:'export const uploadBase64ToPublicUrl=async()=>"https://example.invalid/reference.png";export const uploadBlobToPublicUrl=async()=>null;export const uploadVideoBlobToPublicUrl=async()=>null;export const refreshMediaAccessUrl=async url=>url;',
};
const out=await build({entryPoints:[fileURLToPath(new URL('../src/services/runwayService.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-video',setup(b){
  b.onResolve({filter:/(?:^|\/)(authService|providerRouting|storageService)$/},args=>({path:args.path.split('/').at(-1),namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const {createVideoTask}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const base={prompt:'Synthetic motion',videoModel:'seedance-2.5',videoOperation:'generate',referenceImages:[],referenceVideos:[],referenceAudios:[],videoAspectRatio:'16:9',videoQuality:'720p',videoDuration:5,audioEnabled:true};
for(const provider of ['fal','openrouter','evolink'])for(const textOnly of [false,true])test(`${provider} ${textOnly?'text-only':'first-frame'} submission binds the durable generation without changing task details`,async()=>{
  const oldFetch=globalThis.fetch,oldProvider=globalThis.__videoProvider;const posts=[];
  try {
    globalThis.__videoProvider=provider;
    globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/seedance-video');posts.push(JSON.parse(options.body));return Response.json({taskId:'synthetic-task'});};
    const referenceImages=textOnly?[]:[{id:'first',data:'data:image/png;base64,c3ludGhldGlj',mimeType:'image/png',isFirstFrame:true}];
    const result=await createVideoTask({...base,referenceImages},{id:'gallery-video-id'});
    assert.equal(posts.length,1);assert.equal(posts[0].generationId,'gallery-video-id');
    assert.equal(posts[0].mode,textOnly?'text_to_video':'image_to_video');
    assert.equal(posts[0].provider,provider);assert.equal(posts[0].duration,5);
    assert.equal(result.mode,textOnly?'text_only':'image_to_video');assert.equal(result.taskId,'synthetic-task');
  } finally {globalThis.fetch=oldFetch;if(oldProvider===undefined)delete globalThis.__videoProvider;else globalThis.__videoProvider=oldProvider;}
});
