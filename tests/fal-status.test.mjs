import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Auth and the task registry are stubbed at their import seam; fetch is faked.
const stubs = {
  'auth.js': 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});',
  'providerTasks.js': 'export const requireProviderTask=async()=>true;',
};
const compiled = await build({entryPoints:['api/fal-status.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/_lib\/(auth|providerTasks)\.js$/},args=>({path:args.path.split('/').pop(),namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
    b.onResolve({filter:/^[^./]/},args=>({path:args.path,external:true}));
  }}]});
const {default:handler} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const requests=[];
const poll = async responses => {
  const oldFetch=globalThis.fetch,oldKey=process.env.FAL_KEY,queue=[...responses];
  let status=0,body;
  try{
    process.env.FAL_KEY='synthetic';
    globalThis.fetch=async(url,init)=>{requests.push(`${init?.method||'GET'} ${url}`);const next=queue.shift();return new Response(JSON.stringify(next.body),{status:next.status});};
    const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;},end(){return this;}};
    await handler({method:'GET',query:{requestId:'req_1',endpoint:'openai/gpt-image-2'},headers:{}},res);
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.FAL_KEY;else process.env.FAL_KEY=oldKey;}
  return {status,body};
};
const completed={status:200,body:{status:'COMPLETED'}},failure=status=>({status,body:{detail:[{msg:`fal ${status}`}]}});

test('a fal rate limit or timeout while polling stays retryable instead of failing a finished image',async()=>{
  for (const responses of [[failure(429)],[completed,failure(429)],[failure(408)],[completed,failure(408)]]) {
    const result=await poll(responses);
    assert.equal(result.status,responses.at(-1).status);
    assert.notEqual(result.body?.status,'FAILED');
  }
});

test('a fal rejection while polling is still a permanent failure',async()=>{
  for (const responses of [[failure(400)],[failure(404)],[completed,failure(422)]]) {
    assert.deepEqual(await poll(responses),{status:200,body:{status:'FAILED',error:`fal ${responses.at(-1).status}`,progress:0}});
  }
});

test('after a rate-limited poll, polling the same request again returns the image without a new submission',async()=>{
  requests.length=0;
  const limited=await poll([completed,failure(429)]);
  assert.equal(limited.status,429);
  const retried=await poll([completed,{status:200,body:{images:[{url:'https://fal.media/out.png'}]}}]);
  assert.deepEqual(retried,{status:200,body:{status:'SUCCEEDED',output:['https://fal.media/out.png'],progress:1}});
  // Only status/result reads of the original request; no POST that would start a new paid job.
  assert.deepEqual(requests,Array(2).fill(['GET https://queue.fal.run/openai/gpt-image-2/requests/req_1/status','GET https://queue.fal.run/openai/gpt-image-2/requests/req_1']).flat());
});
