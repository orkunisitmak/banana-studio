import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {transform} from 'esbuild';
import {validLanguage} from '../src/lib/i18n/messages.ts';
const source=fs.readFileSync(new URL('../src/lib/i18n/index.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('i18n.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback;
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='setLanguage')callback=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(callback,'Test the actual provider callback');
const {code}=await transform(`export const create=state=>{const {updateLanguage,storage,local,pending,revision,setSaving,setSaveFailed,fetch,validLanguage}=state;const useCallback=fn=>fn;const LANGUAGE_STORAGE_KEY='banana.ui.language.v1';return ${callback};}`,{loader:'ts',format:'esm'});
const {create}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const writes=[],replies=[],events=[];const state={local:true,pending:{current:Promise.resolve()},revision:{current:0},validLanguage,updateLanguage:value=>events.push(['language',value]),setSaving:value=>events.push(['saving',value]),setSaveFailed:value=>events.push(['failed',value]),storage:()=>({setItem(){}}),fetch:(url,options)=>{assert.equal(url,'/local/query');assert.equal(options.credentials,'same-origin');writes.push(JSON.parse(options.body).args.p_language);return new Promise((resolve,reject)=>replies.push({resolve:value=>resolve({ok:true,json:async()=>({data:value})}),reject}));}};return {state,writes,replies,events,set:create(state)};}
test('actual language callback serializes writes and keeps the latest selection after an earlier failure',async()=>{
 const f=fixture();f.set('tr');f.set('en');await tick();assert.deepEqual(f.writes,['tr']);f.replies[0].reject(new Error('offline'));await tick();assert.deepEqual(f.writes,['tr','en']);assert.ok(!f.events.some(([key,value])=>key==='failed'&&value));f.replies[1].resolve('en');await f.state.pending.current;assert.deepEqual(f.events.slice(-2),[['saving',false],['failed',false]]);assert.equal(f.state.revision.current,2);
});
test('latest failed persistence is visible and retry clears it only after a confirmed write',async()=>{
 const f=fixture();f.set('tr');await tick();f.replies[0].reject(new Error('offline'));await f.state.pending.current;assert.deepEqual(f.events.slice(-2),[['saving',false],['failed',true]]);f.set('tr');await tick();f.replies[1].resolve('tr');await f.state.pending.current;assert.deepEqual(f.events.slice(-2),[['saving',false],['failed',false]]);f.set('fr');assert.equal(f.writes.length,2);
});
