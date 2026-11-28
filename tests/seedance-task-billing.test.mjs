import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const compiled = await build({ entryPoints:['api/_lib/seedanceUsage.ts'], absWorkingDir:fileURLToPath(new URL('..',import.meta.url)), bundle:true, write:false, platform:'node', format:'esm', plugins:[{name:'billing-fixture',setup(build) {
  const stubs = {'./auth.js':'export const createServiceRoleClient=()=>globalThis.__usageDb;', './falBillingCosts.js':'export const fetchFalRequestCosts=async()=>globalThis.__billing;'};
  build.onResolve({filter:/^\.\/(auth|falBillingCosts)\.js$/}, ({path}) => ({path,namespace:'stub'}));
  build.onLoad({filter:/.*/,namespace:'stub'}, ({path}) => ({contents:stubs[path]}));
}}] });
const { recordSeedanceUsage, seedanceActualCost } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('fal Seedance admission is idempotent per task and owner; missing billing is unknown, real zero is persisted', async () => {
  const admissions=[], updates=[];
  const db = {from(table) {
    assert.equal(table,'usage_logs');
    return {upsert:async(row,options)=>{admissions.push({row,options});return {error:null};},update(values){const filters={}; updates.push({values,filters}); return {eq(key,value){filters[key]=value;return this;}};}};
  }};
  const taskId='bs_fal_seedance-2.0_queue_1';
  globalThis.__usageDb=db;
  try {
    for (const user of ['owner','owner','another']) await recordSeedanceUsage(db,user,taskId,'seedance-2.0','reference_to_video','A sailboat');
    const [first,duplicate,other] = admissions;
    assert.equal(first.row.id,duplicate.row.id); assert.notEqual(first.row.id,other.row.id);
    assert.deepEqual(first.options,{onConflict:'id',ignoreDuplicates:true}); assert.equal(first.row.estimated_cost,null);
    globalThis.__billing=new Map();
    assert.equal(await seedanceActualCost('owner',taskId,'queue_1','key'),undefined); assert.deepEqual(updates,[]);
    globalThis.__billing.set('queue_1',0);
    assert.equal(await seedanceActualCost('owner',taskId,'queue_1','key'),0);
    assert.deepEqual(updates,[{values:{estimated_cost:0},filters:{id:first.row.id,user_id:'owner',action:'video_generate'}}]);
  } finally { delete globalThis.__usageDb; delete globalThis.__billing; }
});
