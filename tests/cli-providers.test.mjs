import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// No installed CLI, login, credential file or real subprocess is used.
const fixture={calls:[],mode:'answer',executables:new Set()};
globalThis.__bananaCliFixture=fixture;
const subprocess=`import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import fs from 'node:fs';
export const spawn=(command,args,options)=>{
 const f=globalThis.__bananaCliFixture,child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
 const row={command,args,options,input:'',killed:false};f.calls.push(row);child.kill=()=>{row.killed=true;return true;};
 child.stdin.setEncoding('utf8');child.stdin.on('data',value=>row.input+=value);
 options.signal.addEventListener('abort',()=>{row.aborted=true;queueMicrotask(()=>child.emit('error',new DOMException('Aborted','AbortError')));},{once:true});
 child.stdin.on('finish',()=>{
  if(f.mode==='pending')return;
  if(command.endsWith('codex')||command.endsWith('codex.exe'))fs.writeFileSync(args[args.indexOf('-o')+1],'Çağrı ışık');
  else {const bytes=Buffer.from(JSON.stringify({result:'Çağrı ışık'})),split=bytes.findIndex(v=>v>127)+1;child.stdout.write(bytes.subarray(0,split));child.stdout.write(bytes.subarray(split));}
  queueMicrotask(()=>child.emit('close',0));
 });return child;
};`;
const compiled=await build({entryPoints:['api/_lib/cliProviders.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'synthetic-cli',setup(b){
 b.onResolve({filter:/^node:child_process$/},()=>({path:'child',namespace:'fixture'}));
 b.onResolve({filter:/^node:fs$/},args=>args.namespace==='fixture'?undefined:{path:'fs',namespace:'fixture'});
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='child'?subprocess:`import fs from 'node:fs';export const constants=fs.constants;export const statSync=file=>{if(globalThis.__bananaCliFixture.executables.has(file))return {isFile:()=>true};return fs.statSync(file);};export const accessSync=(file,mode)=>{if(globalThis.__bananaCliFixture.executables.has(file))return;fs.accessSync(file,mode);};`,loader:'js'}));
}}]});
const cli=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-cli-fixture-'));
const old={PATH:process.env.PATH,BANANA_RUNTIME:process.env.BANANA_RUNTIME,TMPDIR:process.env.TMPDIR,BANANA_SUBSCRIPTION_CLI_PREVIEW:process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW};
process.env.PATH=directory;process.env.BANANA_RUNTIME='local';process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW='true';
for(const executable of ['claude','codex'])fs.writeFileSync(path.join(directory,executable+(process.platform==='win32'?'.exe':'')),'synthetic; never executed',{mode:0o700});
const request=(extra={})=>({prompt:'synthetic " & $() prompt',system:'synthetic system',effort:'max',images:[],signal:new AbortController().signal,...extra});
test.after(()=>{for(const [key,value]of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(directory,{recursive:true,force:true});delete globalThis.__bananaCliFixture;});

test('native CLI discovery handles the packaged Mac PATH and rejects Windows cmd shims',()=>{
 const home='/synthetic/home',claude=path.posix.join(home,'.local','bin','claude');fixture.executables.add(claude);
 assert.equal(cli.resolveCliExecutable('claude-cli',{PATH:'/usr/bin:/bin'},'darwin',home),claude);
 const winHome='C:\\Synthetic User',native=path.win32.join(winHome,'.local','bin','codex.exe');fixture.executables.add(native);
 assert.equal(cli.resolveCliExecutable('codex-cli',{PATH:'C:\\Windows\\System32'},'win32',winHome),native);
 fixture.executables.delete(native);fixture.executables.add(path.win32.join(winHome,'.local','bin','codex.cmd'));
 assert.equal(cli.resolveCliExecutable('codex-cli',{PATH:'C:\\Windows\\System32'},'win32',winHome),undefined);
});
test('child env never inherits provider secrets, API billing overrides or Node injection settings',()=>{
 const source={PATH:'/usr/bin',HOME:'/synthetic',LANG:'tr_TR.UTF-8',OPENAI_API_KEY:'synthetic',ANTHROPIC_API_KEY:'synthetic',ANTHROPIC_AUTH_TOKEN:'synthetic',FAL_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic',NODE_OPTIONS:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic'};
 assert.deepEqual(cli.cliEnvironment(source),{NO_COLOR:'1',PATH:'/usr/bin',HOME:'/synthetic',LANG:'tr_TR.UTF-8'});
});
test('Claude receives inline images, no file/MCP tools, exact model and intact UTF-8 output',async()=>{
 fixture.calls=[];
 const text=await cli.runCliText('claude-cli',request({images:[{mimeType:'image/png',data:'c3ludGhldGlj'}],jsonSchema:{type:'object',properties:{title:{type:'string'}}}}));
 assert.equal(text,'Çağrı ışık');const row=fixture.calls[0];assert.equal(row.options.shell,false);
 assert.equal(row.args[row.args.indexOf('--tools')+1],'');assert.equal(row.args[row.args.indexOf('--disallowedTools')+1],'*');assert.equal(row.args.includes('--allowedTools'),false);
 assert.equal(row.args[row.args.indexOf('--model')+1],'claude-opus-5-5');assert.equal(row.args[row.args.indexOf('--effort')+1],'max');
 const body=JSON.parse(row.input);assert.equal(body.message.content[1].source.media_type,'image/png');assert.equal(body.message.content[1].source.data,'c3ludGhldGlj');
 assert.equal(fs.existsSync(row.options.cwd),false,'temporary input directory is removed');
});
test('Codex receives literal argv, pinned model, unchanged effort and disabled command/image/network tools',async()=>{
 fixture.calls=[];
 const text=await cli.runCliText('codex-cli',request({images:[{mimeType:'image/webp',data:'c3ludGhldGlj'}],jsonSchema:{type:'object'}}));
 assert.equal(text,'Çağrı ışık');const row=fixture.calls[0];assert.equal(row.options.shell,false);assert.equal(row.args[row.args.indexOf('--model')+1],'gpt-6.1-sol');
 assert.ok(row.args.includes('model_reasoning_effort="max"'));for(const flag of ['features.shell_tool=false','features.multi_agent=false','features.plugins=false','features.hooks=false','features.memories=false','tools.view_image=false','apps._default.enabled=false','mcp_servers={}','web_search="disabled"','project_doc_max_bytes=0'])assert.ok(row.args.includes(flag),flag);
 for(const flag of ['-o','-i','--output-schema'])assert.equal(row.args[row.args.indexOf(flag)+1].startsWith('"'),false,flag);
 assert.equal(row.args.at(-1),'-');assert.match(row.input,/synthetic " & \$\(\) prompt/);assert.equal(fs.existsSync(row.options.cwd),false);
});
test('abort cancels child work, cleans inputs and rejects remote runtime before spawn',async()=>{
 fixture.calls=[];fixture.mode='pending';const controller=new AbortController(),pending=cli.runCliText('codex-cli',request({signal:controller.signal}));
 while(!fixture.calls.length)await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(pending,/Aborted|abort/i);assert.equal(fixture.calls[0].aborted,true);assert.equal(fs.existsSync(fixture.calls[0].options.cwd),false);
 fixture.mode='answer';const count=fixture.calls.length;process.env.BANANA_RUNTIME='cloud';await assert.rejects(cli.runCliText('claude-cli',request()),/local workspace/);assert.equal(fixture.calls.length,count);process.env.BANANA_RUNTIME='local';
});

test('preview is disabled by default and cannot spawn a child before acceptance',async()=>{delete process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW;const before=fixture.calls.length;try{assert.deepEqual(cli.cliAvailability(),{'claude-cli':false,'codex-cli':false});await assert.rejects(cli.runCliText('codex-cli',request()),/preview is disabled/);assert.equal(fixture.calls.length,before);}finally{process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW='true';}});
