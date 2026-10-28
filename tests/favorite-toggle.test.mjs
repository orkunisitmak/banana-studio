import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

// Exercise the application's real handler without rendering unrelated providers.
const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const start=source.indexOf('  const handleToggleFavorite = async');
const end=source.indexOf('  const handleMoveImages = async',start);
assert.ok(start>0&&end>start);
const {code}=await transform(`export const createHandler=(toggleFavorite,setGeneratedMedia,favoriteTogglesRef,console)=>{${source.slice(start,end)}return handleToggleFavorite;};`,{loader:'ts',format:'esm'});
const {createHandler}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const fixture=()=>{
  let rows=[{id:'a',isFavorite:false},{id:'b',isFavorite:false}];
  const calls=[],pending=new Set();
  const handler=createHandler((id,value)=>{const task=deferred();calls.push({id,value,...task});return task.promise;},update=>{rows=update(rows);},{current:pending},{error(){}});
  return {handler,calls,pending,get rows(){return rows;}};
};

test('overlapping favorite clicks cannot overwrite rollback; failure releases the media lock',async()=>{
  const f=fixture();
  const first=f.handler({...f.rows[0]});
  const overlapping=f.handler({...f.rows[0]});
  await Promise.resolve();
  assert.equal(f.calls.length,1);
  assert.equal(f.rows[0].isFavorite,true);
  f.calls[0].reject(new Error('synthetic save failure'));
  await first;await overlapping;
  assert.equal(f.rows[0].isFavorite,false);
  assert.equal(f.pending.size,0);
  const next=f.handler({...f.rows[0]});
  assert.equal(f.calls.length,2);
  f.calls[1].resolve();await next;
  assert.equal(f.rows[0].isFavorite,true);
});

test('different media can save concurrently and subsequent clicks use the confirmed value',async()=>{
  const f=fixture(),a=f.handler({...f.rows[0]}),b=f.handler({...f.rows[1]});
  assert.deepEqual(f.calls.map(c=>[c.id,c.value]),[['a',true],['b',true]]);
  f.calls[1].resolve();f.calls[0].resolve();await Promise.all([a,b]);
  const next=f.handler({...f.rows[0]});
  assert.equal(f.calls[2].value,false);
  f.calls[2].resolve();await next;
  assert.deepEqual(f.rows.map(r=>r.isFavorite),[false,true]);
  assert.equal(f.pending.size,0);
});
