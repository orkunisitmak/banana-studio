import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { LocalWorkspace } from '../desktop/server/store.mjs';

// Packages stay external as absolute URLs so the bundle can load from memory.
const compiled = await build({entryPoints:['api/_lib/imageJobRunner.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'packages',setup(b){b.onResolve({filter:/^[^./]/},args=>args.path.startsWith('node:')?undefined:{path:import.meta.resolve(args.path),external:true});}}]});
const {runImageJob,ImageJobWait} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('a queued image whose reference was removed fails once without dispatch; temporary storage errors stay retryable',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-jobs-')),store=new LocalWorkspace(directory),oldUrl=process.env.SUPABASE_URL,oldEnv=process.env.VERCEL_ENV;
  try{
    store.origin='http://127.0.0.1:12345';process.env.SUPABASE_URL=store.origin;delete process.env.VERCEL_ENV;
    const db=store.client(true),ledger=()=>store.db.prepare('SELECT payload FROM ledger').all().map(r=>JSON.parse(r.payload));
    const enqueue=async(id,key)=>{await store.upload(key,Buffer.from('synthetic'));store.workerRpc('enqueue_image_job',{p_id:id,p_metadata:{},p_payload:{id,model:'gpt-image-2.5-sunburst',provider:'openai',prompt:'p',displayPrompt:'p',aspectRatio:'1:1',resolution:'1K',options:{},referenceImages:[{id:'r1',data:store.mediaUrl(key),mimeType:'image/png'}],privateReferencePaths:[key],folderId:null}});};
    await enqueue('gone','refs/gone.png');fs.rmSync(store.mediaPath('refs/gone.png'));
    let closingCalls=0;
    const ordered={...db,rpc:async(name,args)=>{
      if(name==='finish_image_job'){
        closingCalls++;
        assert.deepEqual(ledger().filter(r=>r.generationId==='gone').map(r=>r.state),['rejected'],'audit must be finalized before the job can become terminal');
      }
      return db.rpc(name,args);
    }};
    await runImageJob(ordered,{id:'gone',userId:store.user.id});await runImageJob(ordered,{id:'gone',userId:store.user.id});
    assert.equal(closingCalls,1);
    assert.equal(store.job('gone').state,'failed');assert.equal(store.job('gone').dispatchedAt,undefined);
    assert.equal(store.get('generations','gone').status,'failed');assert.match(store.get('generations','gone').metadata.error,/reference is unavailable or was removed/);
    assert.deepEqual(ledger().filter(r=>r.generationId==='gone').map(r=>r.state),['rejected']);
    await enqueue('busy','refs/busy.png');
    const flaky={...db,storage:{from:()=>({createSignedUrl:async()=>({data:null,error:{statusCode:503,message:'unavailable'}})})}};
    await assert.rejects(runImageJob(flaky,{id:'busy',userId:store.user.id}),error=>error.name==='MediaAccessError'&&error.temporary===true);
    assert.equal(store.job('busy').state,'preparing');assert.equal(store.get('generations','busy').status,'pending');
  }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldEnv!==undefined)process.env.VERCEL_ENV=oldEnv;}
});

test('a queued image rejected before dispatch finalizes its audit before the job closes',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-jobs-')),store=new LocalWorkspace(directory),oldUrl=process.env.SUPABASE_URL,oldEnv=process.env.VERCEL_ENV,oldKey=process.env.OPENAI_API_KEY;
  const warn=console.warn;console.warn=()=>{};
  try{
    store.origin='http://127.0.0.1:12345';process.env.SUPABASE_URL=store.origin;delete process.env.VERCEL_ENV;process.env.OPENAI_API_KEY='synthetic';
    const db=store.client(true),ledger=id=>store.db.prepare('SELECT payload FROM ledger').all().map(r=>JSON.parse(r.payload)).filter(r=>r.generationId===id).map(r=>r.state);
    const enqueue=id=>store.workerRpc('enqueue_image_job',{p_id:id,p_metadata:{},p_payload:{id,model:'gpt-image-2.5-sunburst',provider:'openai',prompt:'p',displayPrompt:'p',aspectRatio:'2:1',resolution:'1K',options:{},referenceImages:[],privateReferencePaths:[],folderId:null}});
    enqueue('invalid');
    const ordered={...db,rpc:async(name,args)=>{
      if(name==='finish_image_job')assert.deepEqual(ledger('invalid'),['rejected'],'audit must be finalized before the job can become terminal');
      return db.rpc(name,args);
    }};
    await runImageJob(ordered,{id:'invalid',userId:store.user.id});
    assert.equal(store.job('invalid').state,'failed');
    // While the audit cannot be finalized, the worker reports it and the job stays redeliverable.
    enqueue('interrupted');
    const auditDown={...db,rpc:async(name,args)=>name==='finish_openai_request'?{data:null,error:{message:'connection reset'}}:db.rpc(name,args)};
    await assert.rejects(runImageJob(auditDown,{id:'interrupted',userId:store.user.id}),/finish_openai_request could not be confirmed/);
    assert.equal(store.job('interrupted').state,'preparing');
    assert.deepEqual(ledger('interrupted'),['accepted']);
    // Once audits can be written again, redelivery after the lease ends the job and rejects its new audit.
    const job=store.job('interrupted');job.claimedAt=0;store.job('interrupted',job);
    await runImageJob(db,{id:'interrupted',userId:store.user.id});
    assert.equal(store.job('interrupted').state,'failed');
    assert.equal(ledger('interrupted').at(-1),'rejected');
  }finally{console.warn=warn;store.close();fs.rmSync(directory,{recursive:true,force:true});if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldEnv!==undefined)process.env.VERCEL_ENV=oldEnv;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});

// A synthetic workspace with a counted provider; no real key or network is used.
const withJobs = async run => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-jobs-')),store=new LocalWorkspace(directory);
  const saved={url:process.env.SUPABASE_URL,env:process.env.VERCEL_ENV,key:process.env.OPENAI_API_KEY,fetch:globalThis.fetch};
  const provider={calls:0};
  try{
    store.origin='http://127.0.0.1:12345';process.env.SUPABASE_URL=store.origin;delete process.env.VERCEL_ENV;process.env.OPENAI_API_KEY='synthetic-test-key';
    globalThis.fetch=async url=>{
      assert.match(String(url),/^https:\/\/api\.openai\.com\//);provider.calls++;
      return new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'Synthetic refusal'}}),{status:429,headers:{'retry-after':'90','x-request-id':'req_synthetic'}});
    };
    const enqueue=id=>store.workerRpc('enqueue_image_job',{p_id:id,p_metadata:{},p_payload:{id,model:'gpt-image-2.5-sunburst',provider:'openai',prompt:'p',displayPrompt:'p',aspectRatio:'1:1',resolution:'1K',options:{},referenceImages:[],privateReferencePaths:[],folderId:null}});
    const audits=id=>store.db.prepare('SELECT payload FROM ledger').all().map(r=>JSON.parse(r.payload)).filter(r=>r.generationId===id);
    await run({store,db:store.client(true),provider,enqueue,audits});
  }finally{
    store.close();fs.rmSync(directory,{recursive:true,force:true});globalThis.fetch=saved.fetch;
    for(const [name,value] of [['SUPABASE_URL',saved.url],['VERCEL_ENV',saved.env],['OPENAI_API_KEY',saved.key]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  }
};
const expireLease=(store,id)=>{const job=store.job(id);job.claimedAt=0;job.retryAt=0;store.job(id,job);};

test('a claim lost during slow preparation is retried, not failed, and the retries are bounded',()=>withJobs(async({store,db,provider,enqueue,audits})=>{
  enqueue('slow');
  // The lease expired before dispatch, so dispatch_image_job refuses the claim.
  const expired={...db,rpc:async(name,args)=>name==='dispatch_image_job'?{data:false,error:null}:db.rpc(name,args)};
  for(let attempt=1;attempt<=5;attempt++){
    await assert.rejects(runImageJob(expired,{id:'slow',userId:store.user.id}),error=>error instanceof ImageJobWait);
    const job=store.job('slow');
    assert.equal(job.state,'preparing');assert.equal(job.dispatchedAt,undefined);assert.equal(job.prepareAttempts,attempt);
    assert.equal(store.get('generations','slow').status,'pending');
    expireLease(store,'slow');
  }
  assert.ok(audits('slow').every(r=>r.state==='rejected'));
  await runImageJob(expired,{id:'slow',userId:store.user.id});
  assert.equal(store.job('slow').state,'failed');
  assert.equal(store.get('generations','slow').status,'failed');
  assert.match(store.get('generations','slow').metadata.error,/No generation was submitted/);
  await runImageJob(expired,{id:'slow',userId:store.user.id});
  assert.equal(audits('slow').length,5);
  assert.equal(provider.calls,0,'a lost claim must never reach the provider');
  // A dispatch proves preparation can finish, so it resets the bound.
  enqueue('reset');
  for(let attempt=1;attempt<=3;attempt++){
    await assert.rejects(runImageJob(expired,{id:'reset',userId:store.user.id}),error=>error instanceof ImageJobWait);
    expireLease(store,'reset');
  }
  assert.equal(store.workerRpc('claim_image_job',{p_id:'reset',p_claim:'claim-reset'}).action,'prepare');
  assert.equal(store.workerRpc('dispatch_image_job',{p_id:'reset',p_claim:'claim-reset',p_metadata:{}}),true);
  assert.equal(store.job('reset').prepareAttempts,0);
}));

test('a 429 whose deferral was not saved is requeued instead of failed; other dispatched jobs are only observed',()=>withJobs(async({store,db,provider,enqueue,audits})=>{
  enqueue('limited');
  const lost={...db,rpc:async(name,args)=>name==='defer_refused_image_job'?{data:null,error:{message:'connection reset'}}:db.rpc(name,args)};
  await assert.rejects(runImageJob(lost,{id:'limited',userId:store.user.id}),error=>error instanceof ImageJobWait&&error.afterSeconds===90);
  assert.equal(provider.calls,1);
  assert.ok(store.job('limited').dispatchedAt);
  assert.deepEqual(audits('limited').map(r=>[r.state,r.status]),[['rejected',429]]);
  expireLease(store,'limited');
  // Redelivery requeues the refused dispatch rather than waiting to fail it.
  await assert.rejects(runImageJob(db,{id:'limited',userId:store.user.id}),error=>error instanceof ImageJobWait&&error.afterSeconds===60);
  const job=store.job('limited');
  assert.equal(job.state,'queued');assert.equal(job.dispatchedAt,null);assert.equal(job.claim,null);
  assert.equal(store.get('generations','limited').status,'pending');
  assert.equal(provider.calls,1,'requeueing must not call the provider');
  expireLease(store,'limited');
  assert.equal(store.workerRpc('claim_image_job',{p_id:'limited',p_claim:'claim-again'}).action,'prepare');

  // Any other audit outcome means the provider may have billed: observe only.
  for(const [id,outcome,status] of [['accepted','accepted',undefined],['failed','failed',429],['plain-reject','rejected',null]]){
    enqueue(id);
    const claim=store.workerRpc('claim_image_job',{p_id:id,p_claim:'claim-'+id});
    assert.equal(store.workerRpc('dispatch_image_job',{p_id:id,p_claim:'claim-'+id,p_metadata:{}}),true);
    if(outcome!=='accepted')store.workerRpc('finish_openai_request',{p_id:claim.audit,p_outcome:outcome,p_provider_status:status});
    assert.equal(store.workerRpc('claim_image_job',{p_id:id,p_claim:'other-'+id}).action,'observe');
    assert.ok(store.job(id).dispatchedAt);
  }
}));
