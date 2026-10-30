import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {transform} from 'esbuild';
const file=new URL('../src/services/geminiService.ts',import.meta.url);const source=fs.readFileSync(file,'utf8');const ast=ts.createSourceFile(file.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function initializer(name){let value;const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)value=node.initializer.getText(ast);ts.forEachChild(node,visit);};visit(ast);assert.ok(value,name);return value;}
const state={parts:[],compressions:[]};
const stubs=`const captureTextSettings=async o=>o,getSunburstEditIntent=()=>false,SUNBURST_MODEL='sunburst',buildTextStageRoleCheck=()=>'',buildSunburstGuidance=()=>'',needsBrainstormWardrobe=()=>false,buildConceptWardrobeGuidance=()=>'',getSunburstReferences=r=>r,describeSunburstReference=(_,i)=>'reference '+i,prepareTextStagePrompt=s=>s,getGeminiClient=()=>({}),generateTextContent=async(_,parts)=>{state.parts=parts;return{text:'[]'};},finishTextUsage=async()=>{},logUsage=()=>{};`;
const code=`export const create=(state)=>{${stubs}const createTaskDeadline=()=>({signal:new AbortController().signal,dispose(){}}),waitForTask=p=>p,fetchAsBase64=async img=>img.data,compressBase64Image=async(data,mime,options)=>{state.compressions.push({data,mime,options});return{data:state.impossible?'x'.repeat(3800001):'encoded-png',mimeType:'image/png'};};const TEXT_REQUEST_IMAGE_BUDGET_BYTES=3800000;const resolveReferenceImageData=${initializer('resolveReferenceImageData')};const shrinkInlineImagesToBudget=${initializer('shrinkInlineImagesToBudget')};const runImagePromptTask=${initializer('runImagePromptTask')};return{runImagePromptTask,shrinkInlineImagesToBudget};};`;
const compiled=await transform(code,{loader:'ts',format:'esm'});const {create}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
test('actual Brainstorm caller carries the returned image MIME despite stale attachment metadata',async()=>{
 state.parts=[];state.compressions=[];await create(state).runImagePromptTask('brainstorm','synthetic brief',[{data:'data:image/png;base64,eA==',mimeType:'image/jpeg'}],{imageModel:'other'},'simple',1,undefined,{});
 const inline=state.parts.find(p=>p.inlineData).inlineData;assert.deepEqual(inline,{data:'encoded-png',mimeType:'image/png'});
});
test('request-budget recompression updates MIME together with bytes',async()=>{
 const parts=[{inlineData:{data:'x'.repeat(3800001),mimeType:'image/webp'}}];await create(state).shrinkInlineImagesToBudget(parts);assert.deepEqual(parts[0].inlineData,{data:'encoded-png',mimeType:'image/png'});
});

test('an image set that cannot fit the budget fails before dispatch',async()=>{state.impossible=true;try{await assert.rejects(create(state).shrinkInlineImagesToBudget([{inlineData:{data:'x'.repeat(3800001),mimeType:'image/png'}}]),/too large/);}finally{state.impossible=false;}});
