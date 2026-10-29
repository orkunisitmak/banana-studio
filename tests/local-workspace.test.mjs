import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { startLocalServer } from '../desktop/server/http.mjs';

const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'banana-test-'));return {root,store:new LocalWorkspace(path.join(root,'data')),cleanup(){fs.rmSync(root,{recursive:true,force:true});}};};
test('local records, folders and references persist independently; filters and projections work',async()=>{
  const f=fixture();try {
    const db=f.store.client();const {error}=await db.from('generations').insert([{id:'a',prompt:'One',status:'completed',created_at:1,reference_images:[{personName:'Alex'}]},{id:'b',prompt:'Two',status:'pending',created_at:2}]);assert.equal(error,null);
    let r=await db.from('generations').select('id,prompt').eq('status','completed').single();assert.deepEqual(r.data,{id:'a',prompt:'One'});
    r=await db.from('generations').select('id').order('created_at',{ascending:false}).range(0,0);assert.deepEqual(r.data,[{id:'b'}]);
    assert.equal((await db.from('generations').insert({id:'a'})).error.code,'23505');
    assert.equal((await db.from('generations').update({prompt:'Changed'}).eq('id','a')).error,null);
    const identity=f.store.identity;f.store.close();f.store=new LocalWorkspace(path.join(f.root,'data'));assert.deepEqual(f.store.identity,identity);assert.equal(f.store.get('generations','a').prompt,'Changed');
    if(process.platform!=='win32')assert.equal((fs.statSync(path.join(f.root,'data/workspace.sqlite')).mode&0o777),0o600);
    assert.ok(f.store.execute({table:'profiles',operation:'update',filters:[{column:'id',operator:'eq',value:identity.userId}],value:{role:'other'}},false).error);
    assert.ok(f.store.execute({rpc:'dispatch_image_job',args:{}},false).error);
    assert.ok(f.store.execute({table:'generations',operation:'delete'},false).error);
  } finally {f.store.close();f.cleanup();}
});
test('media paths reject traversal and symlinks; access URLs follow the new local port',async()=>{
  const f=fixture();try {
    for(const value of ['../secret','a/../secret','/absolute','a\\secret','a//b','.hidden',''])assert.throws(()=>f.store.mediaPath(value));
    if(process.platform==='win32')for(const value of ['CON.png','refs/aux','refs/photo.png:secret','refs/photo.','refs/photo '])assert.throws(()=>f.store.mediaPath(value));
    fs.symlinkSync(f.root,path.join(f.store.mediaRoot,'escape'),process.platform==='win32'?'junction':'dir');assert.throws(()=>f.store.mediaPath('escape/file'));
    assert.equal((await f.store.upload('refs/sample.png',Buffer.from('synthetic'))).error,null);
    assert.equal((await f.store.upload('refs/sample.png',Buffer.from('duplicate'))).error.code,'23505');
    f.store.origin='http://127.0.0.1:12345';const old=f.store.mediaUrl('refs/sample.png');f.store.origin='http://127.0.0.1:54321';assert.equal(f.store.materialize({reference:old}).reference,'http://127.0.0.1:54321/storage/v1/object/authenticated/media/refs/sample.png');
    assert.equal(f.store.mediaKey('https://example.com/storage/v1/object/authenticated/media/secret'),null);
  } finally{f.store.close();f.cleanup();}
});
test('Library people, references and templates survive restart with current local preview URLs',async()=>{
 const f=fixture();try{
  f.store.origin='http://127.0.0.1:12001';
  await f.store.upload('refs/library.png',Buffer.from('synthetic-preview'));
  const image=f.store.mediaUrl('refs/library.png');const db=f.store.client();
  assert.equal((await db.from('reference_images').insert({id:'reference',name:'Reference',url:image})).error,null);
  assert.equal((await db.from('saved_people').insert({id:'person',name:'Person',photos:[{url:image}],updated_at:1})).error,null);
  assert.equal((await db.from('templates').insert({id:'template',name:'Template',config:{prompt:'Example @[Reference 1]',referenceImages:[{data:image}]}})).error,null);
  f.store.close();f.store=new LocalWorkspace(path.join(f.root,'data'));f.store.origin='http://127.0.0.1:12002';
  const client=f.store.client();
  assert.equal((await client.from('reference_images').select('*').eq('id','reference').single()).data.url,'http://127.0.0.1:12002/storage/v1/object/authenticated/media/refs/library.png');
  assert.equal((await client.from('saved_people').select('id,cover:photos->0').single()).data.cover.url,f.store.mediaUrl('refs/library.png'));
  assert.equal((await client.from('templates').select('*').single()).data.config.referenceImages[0].data,f.store.mediaUrl('refs/library.png'));
 }finally{f.store.close();f.cleanup();}
});
test('a durable dispatch survives restart and can only be observed, never submitted again',()=>{
  const f=fixture();try {
    const args={p_id:'job-1',p_payload:{prompt:'Synthetic test',displayPrompt:'Synthetic test',referenceImages:[]},p_metadata:{}};
    assert.equal(f.store.workerRpc('enqueue_image_job',args).state,'queued');
    let claim=f.store.workerRpc('claim_image_job',{p_id:'job-1',p_claim:'claim-1'});assert.equal(claim.action,'prepare');
    assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:'job-1',p_claim:'claim-1'}),true);
    f.store.close();f.store=new LocalWorkspace(path.join(f.root,'data'));
    claim=f.store.workerRpc('claim_image_job',{p_id:'job-1',p_claim:'claim-2'});assert.equal(claim.action,'observe');assert.equal(claim.claim,'claim-1');
    assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:'job-1',p_claim:'claim-2'}),false);
    assert.equal(f.store.workerRpc('finish_image_job',{p_id:'job-1',p_claim:'claim-1',p_success:true}),true);
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'job-1',p_claim:'claim-3'}).action,'stop');
  }finally{f.store.close();f.cleanup();}
});
test('loopback server requires native bootstrap, cookie, exact host and mutation origin',async()=>{
  const f=fixture();let local;try{
    const root=path.join(f.root,'web');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'index.html'),'<html>Synthetic</html>');
    const bootstrap=randomBytes(32).toString('hex');local=await startLocalServer({workspace:f.store,root,bootstrap});
    const base=local.origin;
    assert.equal((await fetch(base+'/api/workspace-config')).status,401);
    assert.equal((await fetch(base+'/local/bootstrap',{redirect:'manual'})).status,401);
    const r=await fetch(base+'/local/bootstrap',{redirect:'manual',headers:{'X-Banana-Bootstrap':bootstrap}});assert.equal(r.status,303);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
    const headers={Cookie:cookie.split(';')[0]};const config=await (await fetch(base+'/api/workspace-config',{headers})).json();assert.equal(config.mode,'local');assert.equal(config.userId,f.store.user.id);assert.ok(!JSON.stringify(config).includes(bootstrap));
    const badHost=await new Promise((resolve,reject)=>{const request=http.get(base+'/',{headers:{...headers,Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});assert.equal(badHost,403);
    assert.equal((await fetch(base+'/local/query',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/local/query',{method:'POST',headers:{...headers,Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'})).status,403);
    const response=await fetch(base+'/local/query',{method:'POST',headers:{...headers,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({table:'folders',operation:'insert',value:{id:'folder',name:'Example'}})});assert.equal(response.status,200);assert.equal((await response.json()).error,null);
    const page=await fetch(base+'/',{headers});assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.ok(!(await page.text()).includes(bootstrap));
    await f.store.upload('example.mp4',Buffer.from('0123456789'));const part=await fetch(f.store.mediaUrl('example.mp4'),{headers:{...headers,Range:'bytes=2-4'}});assert.equal(part.status,206);assert.equal(await part.text(),'234');
  }finally{if(local)await local.close();f.store.close();f.cleanup();}
});
test('JSON metadata compare-and-swap matches by value like PostgREST jsonb and rejects stale snapshots',async()=>{
  const f=fixture();try{
    const db=f.store.client(true),metadata={falEndpoint:'minimax/h3-max/text-to-video',nested:{b:2,a:[1,{y:1,x:0}]}};
    await db.from('generations').insert({id:'g',type:'video',status:'processing',task_id:'t',metadata});
    const saved=await db.from('generations').update({status:'failed',metadata:{...metadata,error:'x'}}).eq('id','g').eq('status','processing').eq('metadata',JSON.stringify(metadata)).select('id').maybeSingle();
    assert.deepEqual(saved.data,{id:'g'});assert.equal(f.store.get('generations','g').status,'failed');
    assert.equal((await db.from('generations').update({status:'processing'}).eq('id','g').eq('metadata',JSON.stringify(metadata)).select('id').maybeSingle()).data,null);
    assert.equal((await db.from('generations').select('id').eq('metadata',JSON.stringify({error:'x',nested:{a:[1,{x:0,y:1}],b:2},falEndpoint:metadata.falEndpoint}))).data.length,1);
    assert.equal((await db.from('generations').select('id').eq('metadata','{not json')).data.length,0);
    assert.equal((await db.from('generations').select('id').eq('status','"failed"')).data.length,0);
  } finally{f.store.close();f.cleanup();}
});
test('like SQL, a removed generation is never dispatched and a finished job never changes again',()=>{
  const f=fixture();try {
    const enqueue=id=>f.store.workerRpc('enqueue_image_job',{p_id:id,p_payload:{prompt:'Synthetic test',displayPrompt:'Synthetic test',referenceImages:[]},p_metadata:{}});
    const remove=id=>f.store.execute({table:'generations',operation:'delete',filters:[{column:'id',operator:'eq',value:id}]},false);
    // Removed before the claim: the claim stops and fails the job.
    enqueue('before');remove('before');
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'before',p_claim:'c1'}).action,'stop');
    assert.equal(f.store.job('before').state,'failed');
    // Removed between claim and dispatch: the dispatch guard refuses it.
    enqueue('between');
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'between',p_claim:'c2'}).action,'prepare');
    remove('between');
    assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:'between',p_claim:'c2'}),false);
    // Removed after dispatch: the job is still observed, as in SQL.
    enqueue('after');f.store.workerRpc('claim_image_job',{p_id:'after',p_claim:'c3'});
    assert.equal(f.store.workerRpc('dispatch_image_job',{p_id:'after',p_claim:'c3'}),true);
    remove('after');
    assert.equal(f.store.workerRpc('claim_image_job',{p_id:'after',p_claim:'c4'}).action,'observe');
    // A failure never downgrades a completed row, even while the job is not terminal yet.
    enqueue('row');f.store.workerRpc('claim_image_job',{p_id:'row',p_claim:'c5'});f.store.workerRpc('dispatch_image_job',{p_id:'row',p_claim:'c5'});
    f.store.execute({table:'generations',operation:'update',value:{status:'completed',storage_path:'u/row.png'},filters:[{column:'id',operator:'eq',value:'row'}]},false);
    const completed=structuredClone(f.store.get('generations','row'));
    assert.equal(f.store.workerRpc('finish_image_job',{p_id:'row',p_claim:'c5',p_success:false,p_error:'late failure'}),true);
    // The whole row is kept: status, storage path and metadata (no late error).
    assert.deepEqual(f.store.get('generations','row'),completed);
    // A finished job never changes again.
    assert.equal(f.store.workerRpc('finish_image_job',{p_id:'row',p_claim:'c5',p_success:true}),false);
    assert.equal(f.store.job('row').state,'failed');
  }finally{f.store.close();f.cleanup();}
});

test('re-claiming an expired image preparation rejects its previous audit, as Postgres does', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-reclaim-')), store = new LocalWorkspace(directory);
  try {
    const audits = () => store.db.prepare('SELECT payload FROM ledger').all().map(row => JSON.parse(row.payload)).filter(row => row.generationId === 'job').map(row => row.state);
    store.workerRpc('enqueue_image_job', { p_id: 'job', p_metadata: {}, p_payload: { id: 'job' } });
    store.workerRpc('claim_image_job', { p_id: 'job', p_claim: 'first' });
    assert.equal(store.workerRpc('claim_image_job', { p_id: 'job', p_claim: 'early' }).action, 'wait');
    const job = store.job('job'); job.claimedAt = 0; store.job('job', job);
    assert.equal(store.workerRpc('claim_image_job', { p_id: 'job', p_claim: 'second' }).action, 'prepare');
    assert.deepEqual(audits(), ['rejected', 'accepted']);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
