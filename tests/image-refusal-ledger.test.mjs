import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['api/_lib/imageJobRunner.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'packages',setup(b){b.onResolve({filter:/^[^./]/},args=>args.path.startsWith('node:')?undefined:{path:import.meta.resolve(args.path),external:true});}}]});
const {runImageJob,ImageJobWait}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
for(const [code,reason] of [['rate_limit_exceeded','rate'],['insufficient_quota','quota']])test(`lost ${reason} deferral persists the provider Retry-After and reason with the refusal audit`,async t=>{
 const saved={fetch:globalThis.fetch,key:process.env.OPENAI_API_KEY,env:process.env.VERCEL_ENV};
 process.env.OPENAI_API_KEY='synthetic-test-only';delete process.env.VERCEL_ENV;
 t.after(()=>{globalThis.fetch=saved.fetch;for(const [name,value] of [['OPENAI_API_KEY',saved.key],['VERCEL_ENV',saved.env]])if(value===undefined)delete process.env[name];else process.env[name]=value;});
 let providerCalls=0;const finishes=[];
 globalThis.fetch=async()=>{providerCalls++;return Response.json({error:{code}},{status:429,headers:{'retry-after':'7200','x-request-id':'req_fixture'}});};
 const db={rpc:async(name,args)=>{
  if(name==='claim_image_job')return {data:{action:'prepare',audit:'synthetic-audit',payload:{id:'job',provider:'openai',model:'gpt-image-2.5-sunburst',prompt:'Synthetic',displayPrompt:'Synthetic',aspectRatio:'1:1',resolution:'1K',referenceImages:[]}}};
  if(name==='dispatch_image_job')return {data:true};
  if(name==='defer_refused_image_job')throw new Error('Synthetic database interruption');
  if(name==='finish_openai_request'){finishes.push(args);return {data:null};}
  throw new Error(`Unexpected RPC ${name}`);
 }};
 await assert.rejects(runImageJob(db,{id:'job',userId:'00000000-0000-4000-8000-000000000002'}),e=>e instanceof ImageJobWait&&e.afterSeconds===7200);
 assert.equal(providerCalls,1);
 assert.equal(finishes.length,1);
 assert.equal(finishes[0].p_outcome,'rejected');
 assert.equal(finishes[0].p_provider_status,429);
 assert.equal(finishes[0].p_retry_after,7200);
 assert.equal(finishes[0].p_wait_reason,reason);
});
