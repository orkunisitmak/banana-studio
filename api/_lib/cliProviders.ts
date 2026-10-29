import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CliProvider } from '../../src/lib/providers.js';

const BINARY: Record<CliProvider,string> = { 'claude-cli':'claude', 'codex-cli':'codex' };
export const CLI_MODELS: Record<CliProvider,string> = { 'claude-cli':'claude-opus-5-5', 'codex-cli':'gpt-6.1-sol' };
const EFFORT = new Set(['low','medium','high','xhigh','max']);
const EXTENSIONS: Record<string,string> = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' };

export class CliError extends Error {
  constructor(message:string,readonly status=502){super(message);}
}

// Resolve native executables directly. Never run .cmd/.bat through a shell.
export function resolveCliExecutable(provider:CliProvider,environment:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform,home=os.homedir()):string|undefined {
  const windows=platform==='win32',p=windows?path.win32:path.posix;
  const directories=[...(environment.PATH||'').split(windows?';':':'),p.join(home,'.local','bin')];
  if(windows){if(environment.LOCALAPPDATA)directories.push(p.join(environment.LOCALAPPDATA,'Microsoft','WinGet','Links'));}
  else directories.push('/opt/homebrew/bin','/usr/local/bin',p.join(home,'.npm-global','bin'));
  for(const directory of [...new Set(directories.filter(x=>p.isAbsolute(x)))]){
    const file=p.join(directory,BINARY[provider]+(windows?'.exe':''));
    try{if(!statSync(file).isFile())continue;accessSync(file,windows?constants.F_OK:constants.X_OK);return file;}catch{/* try next supported installation */}
  }
}
export const cliAvailability = ():Record<CliProvider,boolean> => (process.env.BANANA_RUNTIME!=='local'||process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW!=='true')
  ? {'claude-cli':false,'codex-cli':false}
  : {'claude-cli':process.env.CLAUDE_CLI_ENABLED!=='false'&&!!resolveCliExecutable('claude-cli'),'codex-cli':process.env.CODEX_CLI_ENABLED!=='false'&&!!resolveCliExecutable('codex-cli')};

// Forward only the OS/locale values needed by the user's local native CLI.
// In particular, application provider keys, API billing overrides, Node hooks,
// plugin settings and cloud-provider credentials never enter the child env.
export function cliEnvironment(source:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
  const result:NodeJS.ProcessEnv={NO_COLOR:'1'};
  for(const key of ['PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE'])if(source[key])result[key]=source[key];
  return result;
}
export interface CliImage {mimeType:string;data:string}
export interface CliRequest {prompt:string;system:string;effort:string;images:CliImage[];jsonSchema?:object;signal:AbortSignal}

const run = (command:string,args:string[],stdin:string,cwd:string,signal:AbortSignal):Promise<{code:number|null;stdout:string;stderr:string}> => new Promise((resolve,reject)=>{
  if(signal.aborted){reject(signal.reason||new DOMException('Aborted','AbortError'));return;}
  const child=spawn(command,args,{cwd,shell:false,windowsHide:true,signal,env:cliEnvironment()});
  let stdout='',stderr='',bytes=0,settled=false;
  const fail=(error:Error)=>{if(!settled){settled=true;reject(error);}};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',(chunk:string)=>{bytes+=Buffer.byteLength(chunk);if(bytes>8_000_000){child.kill();fail(new CliError('CLI output exceeded the safe response limit.'));return;}stdout+=chunk;});
  child.stderr.on('data',(chunk:string)=>{stderr=(stderr+chunk).slice(-4000);});
  child.on('error',fail);child.on('close',code=>{if(!settled){settled=true;resolve({code,stdout,stderr});}});
  child.stdin.on('error',()=>{});child.stdin.end(stdin);
});

export async function runCliText(provider:CliProvider,request:CliRequest):Promise<string> {
  if(process.env.BANANA_RUNTIME!=='local')throw new CliError('Subscription CLI routes are available only in a local workspace.',403);
  if(process.env.BANANA_SUBSCRIPTION_CLI_PREVIEW!=='true')throw new CliError('Subscription CLI preview is disabled pending explicit account and isolation acceptance.',503);
  if(!EFFORT.has(request.effort))throw new CliError('Unsupported thinking effort.',400);
  if(request.images.some(image=>!EXTENSIONS[image.mimeType]))throw new CliError('Unsupported reference image type.',400);
  if(!cliAvailability()[provider])throw new CliError(`${BINARY[provider]} native executable was not found or this route is disabled.`,503);
  const command=resolveCliExecutable(provider)!;
  const directory=await mkdtemp(path.join(os.tmpdir(),'banana-cli-'));
  try{
    if(provider==='claude-cli'){
      // Inline image messages remove the need to grant any filesystem tool.
      const args=['--restricted','-p','--model',CLI_MODELS[provider],'--output-format','json','--input-format','stream-json','--no-session-persistence','--setting-sources','','--disable-slash-commands','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','','--disallowedTools','*','--effort',request.effort,'--system-prompt','You write prompts for image and video generators.'];
      if(request.jsonSchema)args.push('--json-schema',JSON.stringify(request.jsonSchema));
      const content=[{type:'text',text:`${request.system}\n\n${request.prompt}`},...request.images.map(image=>({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.data}}))];
      const input=JSON.stringify({type:'user',message:{role:'user',content}})+'\n';
      const {code,stdout,stderr}=await run(command,args,input,directory,request.signal);
      let result:any;try{result=JSON.parse(stdout);}catch{/* safe error below */}
      if(code!==0||!result||result.is_error)throw new CliError(cliMessage(provider,stderr||result?.result));
      const text=result.structured_output!=null?JSON.stringify(result.structured_output):result.result;
      if(typeof text!=='string'||!text.trim())throw new CliError('Claude returned an empty response.');
      return text;
    }
    const output=path.join(directory,'answer.txt');
    const args=['exec','--skip-git-repo-check','--ephemeral','--ignore-rules','--ignore-user-config','--sandbox','read-only','--model',CLI_MODELS[provider],'-o',output,
      '-c',`model_reasoning_effort="${request.effort}"`,'-c','features.shell_tool=false','-c','features.multi_agent=false','-c','features.plugins=false','-c','features.hooks=false','-c','features.memories=false','-c','tools.view_image=false','-c','apps._default.enabled=false','-c','mcp_servers={}','-c','web_search="disabled"','-c','project_doc_max_bytes=0'];
    for(const [index,image]of request.images.entries()){
      const file=path.join(directory,`reference-${index+1}.${EXTENSIONS[image.mimeType]}`);await writeFile(file,Buffer.from(image.data,'base64'),{mode:0o600});args.push('-i',file);
    }
    if(request.jsonSchema){const file=path.join(directory,'schema.json');await writeFile(file,JSON.stringify(request.jsonSchema),{mode:0o600});args.push('--output-schema',file);}
    args.push('-');
    const {code,stderr}=await run(command,args,`${request.system}\n\n${request.prompt}`,directory,request.signal);
    const text=await readFile(output,'utf8').catch(()=>'');
    if(code!==0||!text.trim())throw new CliError(cliMessage(provider,stderr));
    if(Buffer.byteLength(text)>8_000_000)throw new CliError('CLI output exceeded the safe response limit.');
    return text;
  }finally{await rm(directory,{recursive:true,force:true}).catch(()=>{});}
}
const cliMessage=(provider:CliProvider,detail?:string)=>{
  const name=provider==='claude-cli'?'Claude':'Codex';
  if(/log ?in|auth|credential|sign/i.test(detail||''))return `${name} oturumu açık değil. Terminalde giriş yapıp yeniden dene.`;
  if(/limit|quota|rate/i.test(detail||''))return `${name} abonelik limiti doldu. Daha sonra yeniden dene.`;
  return `${name} isteği tamamlanamadı. Güncel native CLI kurulumunu ve model erişimini kontrol et.`;
};
