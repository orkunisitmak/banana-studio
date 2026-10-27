import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({entryPoints:[fileURLToPath(new URL('../src/lib/references/localReferenceBudget.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {fitLocalReferences} = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const person=(personId,count,name)=>Array.from({length:count},(_,i)=>({id:`${name}-${i+1}`,data:'x',mimeType:'image/png',personId,personName:name}));
const ids=refs=>refs.map(ref=>ref.id);

test('eleven photos of one saved person keep her first six instead of failing the job',()=>{
  const fit=fitLocalReferences(person(1,11,'Zehra'),6);
  assert.deepEqual(ids(fit.kept),['Zehra-1','Zehra-2','Zehra-3','Zehra-4','Zehra-5','Zehra-6']);
  assert.equal(fit.skipped.length,5);
});

test('the edit source and other references are always kept; people share the rest round-robin in order',()=>{
  const source={id:'source',data:'x',mimeType:'image/png',isEditSource:true};
  const refs=[source,...person(1,8,'Zehra'),...person(2,3,'Ali')];
  const fit=fitLocalReferences(refs,6);
  assert.deepEqual(ids(fit.kept),['source','Zehra-1','Zehra-2','Zehra-3','Ali-1','Ali-2']);
  assert.equal(fit.skipped.length,6);
});

test('references that cannot fit without dropping a person or a non-person image are refused clearly',()=>{
  const loose=Array.from({length:4},(_,i)=>({id:'style'+i,data:'x',mimeType:'image/png'}));
  const fit=fitLocalReferences([...loose,...person(1,2,'A'),...person(2,2,'B'),...person(3,2,'C')],6,'FLUX 3 Klein · Local');
  assert.match(fit.error,/FLUX 3 Klein · Local uses up to 6 reference images.*Remove 1 reference/);
  assert.equal(fit.kept,undefined);
});

test('six or fewer references pass through untouched',()=>{
  const refs=person(1,6,'Zehra');
  const fit=fitLocalReferences(refs,6);
  assert.equal(fit.kept,refs);assert.deepEqual(fit.skipped,[]);
});
