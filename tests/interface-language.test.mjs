import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalWorkspace} from '../desktop/server/store.mjs';
import {initialLanguage} from '../src/lib/i18n/messages.ts';
import {randomBytes} from 'node:crypto';
import {startLocalServer} from '../desktop/server/http.mjs';
test('desktop language persists in the existing settings table across workspace reopen and origin changes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'banana-language-'));let store;
 try{store=new LocalWorkspace(dir);assert.equal(store.execute({rpc:'get_interface_language'},false).data,null);
 for(const language of ['tr','en']){assert.equal(store.execute({rpc:'save_interface_language',args:{p_language:language}},false).data,language);store.close();store=new LocalWorkspace(dir);store.origin='http://127.0.0.1:43219';assert.equal(store.execute({rpc:'get_interface_language'},false).data,language);assert.equal(initialLanguage({getItem:()=>language==='tr'?'en':'tr'},'en-US',store.setting('interfaceLanguage')),language);}
 for(const value of ['fr',null,{},'__proto__'])assert.ok(store.execute({rpc:'save_interface_language',args:{p_language:value}},false).error);
 assert.equal(store.setting('interfaceLanguage'),'en');
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('authenticated desktop HTTP bootstrap restores language on a different port; invalid or cross-origin writes cannot change it',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'banana-language-http-'));
 const root=path.join(dir,'web');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'index.html'),'Synthetic only');
 let store=new LocalWorkspace(path.join(dir,'data'));const servers=[];
 const start=async()=>{const bootstrap=randomBytes(32).toString('hex');const server=await startLocalServer({workspace:store,root,bootstrap});servers.push(server);
  const response=await fetch(server.origin+'/local/bootstrap',{redirect:'manual',headers:{'X-Banana-Bootstrap':bootstrap}});
  assert.equal(response.status,303);return {server,headers:{Cookie:response.headers.get('set-cookie').split(';')[0]}};};
 try{
  const first=await start();
  assert.equal((await fetch(first.server.origin+'/local/query',{method:'POST',headers:{...first.headers,Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({rpc:'save_interface_language',args:{p_language:'tr'}})})).status,403);
  for(const language of ['tr','en']){
   const result=await fetch(first.server.origin+'/local/query',{method:'POST',headers:{...first.headers,Origin:first.server.origin,'Content-Type':'application/json'},body:JSON.stringify({rpc:'save_interface_language',args:{p_language:language}})});
   assert.equal((await result.json()).data,language);
  }
  const invalid=await fetch(first.server.origin+'/local/query',{method:'POST',headers:{...first.headers,Origin:first.server.origin,'Content-Type':'application/json'},body:JSON.stringify({rpc:'save_interface_language',args:{p_language:'fr'}})});assert.ok((await invalid.json()).error);
  store.close();store=new LocalWorkspace(path.join(dir,'data'));
  const second=await start();assert.notEqual(second.server.origin,first.server.origin);
  const config=await (await fetch(second.server.origin+'/api/workspace-config',{headers:second.headers})).json();assert.equal(config.language,'en');
  assert.equal(initialLanguage(undefined,'tr-TR',config.language),'en');
 }finally{for(const server of servers)await server.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
