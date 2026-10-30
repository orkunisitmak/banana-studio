import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const f=globalThis.__providerTaskOwnerFixture={};
const compiled=await build({entryPoints:['api/seedance-video.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
 name:'private-task-fixture',setup(b){
  b.onResolve({filter:/\/auth\.js$/},()=>({path:'auth',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const f=globalThis.__providerTaskOwnerFixture;
   export const requireUser=async()=>f.user;export const applyCors=()=>{};
   export const createUserScopedClient=()=>f.db;export const createServiceRoleClient=()=>f.serviceDb;`,loader:'js'}));
  b.onResolve({filter:/^[^./]/},args=>args.path.startsWith('node:')?undefined:{path:import.meta.resolve(args.path),external:true});
 }
}]});
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function setup(t,{owner='member',caller='admin',missing=false}={}){
 const savedFetch=globalThis.fetch,savedKey=process.env.OPENROUTER_API_KEY;
 process.env.OPENROUTER_API_KEY='synthetic-test-only';
 t.after(()=>{globalThis.fetch=savedFetch;if(savedKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=savedKey;});
 const objects=new Map(),queries=[];let fetched=0;
 f.user={id:caller};f.db={from(table){assert.equal(table,'provider_tasks');let columns;
  const query={select(value){columns=value;return query;},eq(){return query;},async maybeSingle(){return {data:missing?null:Object.fromEntries(columns.split(',').map(c=>[c,c==='user_id'?owner:'bs_openrouter_seedance-2.5_task'])),error:null};}};return query;
 },storage:{from(){return {async createSignedUrl(path){queries.push(path);return objects.has(path)?{data:{signedUrl:`https://storage.invalid/${path}`}}:{error:{status:404}};},async upload(path,bytes){if(!path.startsWith(caller+'/'))return {error:{status:403}};objects.set(path,bytes);return {error:null};}};}}};
 f.serviceDb={storage:{from(){return {async createSignedUrl(path){return objects.has(path)?{data:{signedUrl:`https://storage.invalid/${path}`}}:{error:{status:404}};},async upload(path,bytes){objects.set(path,bytes);return {error:null};}};}}};
 globalThis.fetch=async url=>{fetched++;return String(url).includes('/content?')?new Response('synthetic-video'):Response.json({status:'completed'});};
 const response={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
 return {objects,queries,response,get fetched(){return fetched;}};
}
test('administrator polling copies unsigned OpenRouter output into the registered task owner storage',async t=>{
 const fixture=setup(t);
 await handler({method:'GET',query:{taskId:'bs_openrouter_seedance-2.5_task'}},fixture.response);
 assert.equal(fixture.response.statusCode,200);
 assert.equal(fixture.response.body.status,'SUCCEEDED');
 assert.deepEqual([...fixture.objects.keys()],['member/openrouter-video/task.mp4']);
 assert.match(fixture.response.body.output[0],/member\/openrouter-video\/task\.mp4/);
});
test('an unknown provider task never fetches provider output',async t=>{
 const fixture=setup(t,{missing:true});
 await handler({method:'GET',query:{taskId:'bs_openrouter_seedance-2.5_task'}},fixture.response);
 assert.equal(fixture.response.statusCode,404);assert.equal(fixture.fetched,0);assert.equal(fixture.objects.size,0);
});
