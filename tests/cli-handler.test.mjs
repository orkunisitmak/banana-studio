import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const state={signals:[]};globalThis.__bananaCliHandler=state;
const compiled=await build({entryPoints:['api/cli-text-generate.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-cli-handler',setup(b){
 b.onResolve({filter:/\/(auth|cliProviders)\.js$/},args=>({path:args.path.includes('cliProviders')?'cli':'auth',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='auth'?`export const applyCors=()=>{};export const requireUser=async()=>({id:'synthetic-user'});`:`export class CliError extends Error{};export const cliAvailability=()=>({'codex-cli':true,'claude-cli':true});export const runCliText=async(provider,request)=>{globalThis.__bananaCliHandler.signals.push(request.signal);return new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});};`,loader:'js'}));
}}]});
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
class Response extends EventEmitter {
  writableEnded=false;destroyed=false;writes=[];
  setHeader(){}status(code){this.statusCode=code;return this;}json(value){this.writes.push(value);this.writableEnded=true;return this;}write(value){this.writes.push(value);}end(){this.writableEnded=true;}
}
test('disconnect aborts subscription work in streaming and non-streaming handlers without writing to a closed client',async()=>{
 const previous=process.env.BANANA_RUNTIME;process.env.BANANA_RUNTIME='local';
 try{for(const streaming of [false,true]){
   state.signals=[];const response=new Response();
   const pending=handler({method:'POST',headers:streaming?{accept:'application/x-ndjson'}:{},body:{cliProvider:'codex-cli',model:'gpt-6.1-sol',reasoningEffort:'low',contents:{parts:[{text:'synthetic'}]},usageContext:{action:'enhance',prompt:'synthetic'}}},response);
   while(!state.signals.length)await new Promise(resolve=>setImmediate(resolve));
   const writes=response.writes.length;response.destroyed=true;response.emit('close');await pending;
   assert.equal(state.signals[0].aborted,true);assert.equal(response.writes.length,writes);assert.equal(response.listenerCount('close'),0);
 }}finally{if(previous===undefined)delete process.env.BANANA_RUNTIME;else process.env.BANANA_RUNTIME=previous;}
});
