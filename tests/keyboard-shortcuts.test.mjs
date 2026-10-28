import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { transform } from 'esbuild';

async function handler(file,name,parameters,after='') {
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer;
  const visit=node=>{
    if(!initializer&&ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)initializer=node.initializer.getText(ast);
    ts.forEachChild(node,visit);
  };
  visit(ast);assert.ok(initializer,`${name} must be the application's real handler`);
  const {code}=await transform(`export const create=(${parameters})=>{${after}return ${initializer};};`,{loader:'ts',format:'esm'});
  return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).create;
}
const createGlobal=await handler('../src/components/Controls.tsx','handleKeyDown','state',`const {canGenerate=true,isBrainstormActive=false,isBrainstormPanelOpen=false,handleGenerate,handleBrainstorm,setIsBrainstormPanelOpen,document}=state;`);
const createTextarea=await handler('../src/components/Controls.tsx','handleTextareaKeyDown','canGenerate,handleGenerate,document','const h3PromptSupported=false;');
const createHistory=await handler('../src/components/HistoryPanel.tsx','handleKeyDown','onClose,document');
const createAdmin=await handler('../src/components/AdminPanel.tsx','handleKeyDown','onClose');
const event=(key='Enter',extra={})=>({key,ctrlKey:true,metaKey:false,repeat:false,isComposing:false,nativeEvent:{isComposing:false},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra});
function setup(overrides={}) {
  const calls={generate:0,brainstorm:0,closed:0};
  const state={handleGenerate:()=>calls.generate++,handleBrainstorm:()=>calls.brainstorm++,setIsBrainstormPanelOpen:()=>calls.closed++,document:{querySelector:()=>null},...overrides};
  return {calls,global:createGlobal(state),textarea:createTextarea(state.canGenerate??true,state.handleGenerate,state.document)};
}

test('textarea shortcut submits once after document bubbling, and busy state does not change validation',()=>{
  const f=setup(),e=event();f.textarea(e);f.global(e);assert.equal(f.calls.generate,1);assert.equal(e.defaultPrevented,true);
  const disabled=setup({canGenerate:false});const invalid=event();disabled.textarea(invalid);disabled.global(invalid);assert.equal(disabled.calls.generate,0);
  const mac=setup();mac.global(event('Enter',{ctrlKey:false,metaKey:true}));assert.equal(mac.calls.generate,1);
});
test('repeated, composing and already consumed events never submit; Brainstorm owns its shortcut',()=>{
  for(const extra of [{repeat:true},{isComposing:true,nativeEvent:{isComposing:true}},{defaultPrevented:true}]){
    const f=setup(),e=event('Enter',extra);f.textarea(e);f.global(e);assert.equal(f.calls.generate,0);
  }
  const f=setup({canGenerate:false,isBrainstormActive:true});const e=event();f.textarea(e);f.global(e);assert.equal(f.calls.generate,0);assert.equal(f.calls.brainstorm,1);
});
test('modal dialogs retain shortcuts and Escape; background panels cannot close or generate',()=>{
  const document={querySelector:()=>({})};
  const f=setup({document,isBrainstormPanelOpen:true});f.textarea(event());f.textarea(event('Enter',{ctrlKey:false,metaKey:true}));f.global(event());f.global(event('Escape'));assert.deepEqual(f.calls,{generate:0,brainstorm:0,closed:0});
  let history=0,admin=0;const h=createHistory(()=>history++,document),a=createAdmin(()=>admin++);const e=event('Escape');h(e);a(e);assert.equal(history,0);assert.equal(admin,1);
});
test('Escape closes one eligible panel and respects previously prevented events',()=>{
  let history=0,admin=0;const document={querySelector:()=>null};const h=createHistory(()=>history++,document),a=createAdmin(()=>admin++);
  const e=event('Escape');h(e);a(e);assert.equal(history,1);assert.equal(admin,0);assert.equal(e.defaultPrevented,true);
  const f=setup({isBrainstormPanelOpen:true});f.global(event('Escape'));assert.equal(f.calls.closed,1);
});
