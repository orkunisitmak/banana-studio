import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const f=globalThis.__videoPersistenceFixture={};
async function load(file){
 const compiled=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'video-persistence-fixture',setup(b){
  b.onResolve({filter:/\/auth\.js$/},()=>({path:'auth',namespace:'fixture'}));
  b.onResolve({filter:/\/h3Usage\.js$/},()=>({path:'usage',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='usage'?'export const recordH3Usage=async()=>{};':`const f=globalThis.__videoPersistenceFixture;export const applyCors=()=>{};export const requireUser=async()=>({id:'member'});export const createServiceRoleClient=()=>f.db;export const createUserScopedClient=()=>f.db;`,loader:'js'}));
  b.onResolve({filter:/^[^./]/},args=>args.path.startsWith('node:')?undefined:{path:import.meta.resolve(args.path),external:true});
 }}]});
 return (await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))).default;
}
const seedance=await load('api/seedance-video.ts'),evolink=await load('api/evolink-generate.ts'),h3=await load('api/fal-h3-video.ts');
const common={generationId:'video-job',videoModel:'seedance-2.5',mode:'text_only',prompt:'Synthetic motion',duration:5,quality:'720p',aspectRatio:'16:9',generateAudio:true};
const cases=[['seedance legacy text',seedance,{...common,provider:'fal'},'bs_fal_seedance-2.5_accepted','bytedance/seedance-2.5/text-to-video'],['seedance EvoLink',seedance,{...common,provider:'evolink',mode:'text_to_video'},'accepted','seedance-2.5-text-to-video'],['seedance',seedance,{...common,provider:'fal',mode:'text_to_video'},'bs_fal_seedance-2.5_accepted','bytedance/seedance-2.5/text-to-video'],['evolink',evolink,common,'accepted','seedance-2.5-text-to-video'],['h3',h3,{generationId:'video-job',mode:'text_to_video',prompt:'Synthetic motion',duration:5,resolution:'768P',aspectRatio:'16:9'},'accepted','minimax/h3-max/text-to-video']];
function fixture(t,{saveFails=false,foreign=false}={}){
 const previous={fetch:globalThis.fetch,keys:Object.fromEntries(['FAL_KEY','EVOLINK_API_KEY'].map(k=>[k,process.env[k]]))};
 for(const k of Object.keys(previous.keys))process.env[k]='synthetic-test-only';
 t.after(()=>{globalThis.fetch=previous.fetch;for(const[k,v]of Object.entries(previous.keys))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const generation={id:'video-job',user_id:foreign?'foreign':'member',type:'video',status:'pending',task_id:null,metadata:{originalPrompt:'Synthetic'}};
 const tasks=[];let paidCalls=0;
 globalThis.fetch=async()=>{paidCalls++;return Response.json({id:'accepted',request_id:'accepted'});};
 f.db={from(table){let filters=[],op='read',values,columns='*',limit;
  const q={select(v){columns=v;return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},limit(v){limit=v;return q;},insert(v){op='insert';values=v;return q;},update(v){op='update';values=v;return q;},async maybeSingle(){const result=await execute();return {...result,data:result.data?.[0]||null};},then(resolve,reject){return execute().then(resolve,reject);}};
  async function execute(){
   const matches=r=>filters.every(([k,v])=>typeof r[k]==='object'&&typeof v==='string'?JSON.stringify(r[k])===v:r[k]===v);
   if(op==='insert'){assert.equal(table,'provider_tasks');tasks.push({...values});return {data:null,error:null};}
   const rows=(table==='generations'?[generation]:tasks).filter(matches).slice(0,limit);
   if(op==='update'){
    if(saveFails&&'task_id'in values)return {data:null,error:{code:'synthetic_write_failure'}};
    rows.forEach(row=>Object.assign(row,values));
   }
   return {data:rows.map(row=>columns==='*'?{...row}:Object.fromEntries(columns.split(',').map(k=>[k,row[k]]))),error:null};
  }
  return q;
 }};
 return {generation,tasks,get paidCalls(){return paidCalls;}};
}
async function invoke(handler,body){const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};await handler({method:'POST',body},res);return res;}
for(const[name,handler,body,taskId,endpoint]of cases){
 test(`${name} acceptance binds its task and endpoint to the saved generation on the server`,async t=>{
  const fx=fixture(t),res=await invoke(handler,body);
  assert.equal(res.statusCode,200);assert.equal(res.body.taskId,taskId);assert.equal(fx.paidCalls,1);
  assert.equal(fx.generation.task_id,taskId);assert.equal(fx.generation.metadata.falEndpoint,endpoint);
  assert.equal(fx.tasks[0].generation_id,'video-job');assert.equal(fx.tasks[0].task_metadata.falEndpoint,endpoint);
 });
 test(`${name} retains a recoverable private association when gallery acknowledgement fails`,async t=>{
  const fx=fixture(t,{saveFails:true}),res=await invoke(handler,body);
  assert.equal(res.statusCode,200);assert.equal(res.body.taskId,taskId);assert.equal(fx.paidCalls,1);
  assert.equal(fx.tasks[0].generation_id,'video-job');assert.equal(fx.tasks[0].task_metadata.falEndpoint,endpoint);
  assert.equal(typeof res.body.persistenceWarning,'string');
  const replay=await invoke(handler,body);
  assert.equal(replay.statusCode,200);assert.equal(replay.body.taskId,taskId);assert.equal(fx.paidCalls,1);
 });
 test(`${name} concurrent submissions charge the provider at most once`,async t=>{
  const fx=fixture(t),responses=await Promise.all([invoke(handler,body),invoke(handler,body)]);
  assert.ok(responses.some(res=>res.statusCode===200&&res.body.taskId===taskId));
  assert.ok(responses.every(res=>[200,409].includes(res.statusCode)));
  assert.equal(fx.paidCalls,1);assert.equal(fx.tasks.length,1);
 });
 test(`${name} rejects a foreign saved generation before charging the provider`,async t=>{
  const fx=fixture(t,{foreign:true}),res=await invoke(handler,body);
  assert.equal(res.statusCode,404);assert.equal(fx.paidCalls,0);assert.equal(fx.tasks.length,0);
 });
}
