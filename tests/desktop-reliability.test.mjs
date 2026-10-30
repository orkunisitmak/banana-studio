import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { startLocalServer } from '../desktop/server/http.mjs';

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-reliability-'));
  const store = new LocalWorkspace(path.join(root, 'data'));
  return {root, store, close() { store.close(); fs.rmSync(root, {recursive: true, force: true}); }};
};
for (const operation of ['update', 'delete']) test(`multirow ${operation} rolls back after a SQLite write error`, async () => {
  const f = fixture();
  try {
    await f.store.client().from('generations').insert([{id:'a',status:'pending'}, {id:'b',status:'pending'}]);
    const before = f.store.all('generations');
    const event = operation === 'update' ? 'INSERT' : 'DELETE';
    const row = operation === 'update' ? 'NEW' : 'OLD';
    f.store.db.exec(`CREATE TRIGGER injected_failure BEFORE ${event} ON records WHEN ${row}.collection='generations' AND ${row}.id='b' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;`);
    const result = f.store.execute({table:'generations',operation,filters:[{column:'status',operator:'eq',value:'pending'}],value:{status:'completed'}});
    assert.ok(result.error);
    assert.deepEqual(f.store.all('generations'), before);
  } finally { f.close(); }
});
for (const stage of ['write', 'rename']) test(`failed upload ${stage} removes partial temporary media`, async () => {
  const f = fixture(), originalWrite = fs.writeFileSync, originalRename = fs.renameSync;
  try {
    const target = f.store.mediaPath('uploads/synthetic.png');
    await f.store.upload('uploads/synthetic.png', Buffer.from('original'));
    if (stage === 'write') fs.writeFileSync = (file, ...args) => {
      if (String(file).startsWith(target + '.')) { originalWrite(file, Buffer.from('partial')); throw new Error('injected full disk'); }
      return originalWrite(file, ...args);
    };
    else fs.renameSync = (from, to) => { if (to === target) throw new Error('injected rename error'); return originalRename(from, to); };
    await assert.rejects(f.store.upload('uploads/synthetic.png', Buffer.from('replacement'), {upsert:true}));
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(path.dirname(target)), ['synthetic.png']);
  } finally { fs.writeFileSync = originalWrite; fs.renameSync = originalRename; f.close(); }
});
test('cancelling a large media response closes its file stream', async () => {
  const f = fixture(), original = fs.createReadStream;
  let local, stream;
  try {
    const root = path.join(f.root, 'web'); fs.mkdirSync(root);
    const media = f.store.mediaPath('large.mp4');
    const file = fs.openSync(media, 'w'); fs.ftruncateSync(file, 128 * 1024 * 1024); fs.closeSync(file);
    fs.createReadStream = (...args) => { const result = original(...args); if (args[0] === media) stream = result; return result; };
    const bootstrap = 'a'.repeat(64);
    local = await startLocalServer({workspace:f.store,root,bootstrap});
    await new Promise((resolve,reject) => {
      const request = http.get(f.store.mediaUrl('large.mp4'), {headers:{Cookie:`banana_${bootstrap.slice(0,12)}=${bootstrap}`}}, response => {
        response.once('data', () => { response.destroy(); resolve(); }); response.on('error', () => {});
      }); request.on('error', reject);
    });
    if (!stream?.closed) await new Promise(resolve => {
      const deadline = setTimeout(resolve, 2000);
      stream.once('close', () => { clearTimeout(deadline); resolve(); });
    });
    assert.equal(stream?.closed, true, 'cancelled response must close the underlying file descriptor');
  } finally { stream?.destroy(); fs.createReadStream = original; if (local) await local.close(); f.close(); }
});
test('common SQL lookups and pagination preserve filtering, count, and unusual field values', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 160; i++) f.store.put('generations', `g${String(i).padStart(3,'0')}`, {id:`g${String(i).padStart(3,'0')}`,user_id:i%2?'user-b':'user-a',status:i%3?'completed':'pending',folder_id:i%4?'folder-a':null,created_at:i});
    f.store.put('generations','object-status',{id:'object-status',status:{b:2,a:1}});
    f.store.put('generations','missing-folder',{id:'missing-folder'});
    const plans = [
      {filters:[{column:'id',operator:'eq',value:'g080'}]},
      {filters:[{column:'user_id',operator:'eq',value:'user-a'},{column:'status',operator:'in',value:['completed','pending']}],range:[8,19],count:'exact'},
      {filters:[{column:'folder_id',operator:'is',value:null}],range:[3,9],count:'exact',columns:'id'},
      {filters:[{column:'status',operator:'eq',value:'{"a":1,"b":2}'}]},
      {filters:[{column:'status',operator:'neq',value:'pending'}],order:[{column:'created_at',ascending:false}],range:[2,7]},
      {filters:[],range:[10,15],count:'exact'},
    ];
    const originalAll = f.store.all.bind(f.store);
    for (const details of plans) {
      const plan = {table:'generations',operation:'select',...details};
      const optimized = f.store.selectRows;
      f.store.selectRows = () => null;
      const expected = f.store.execute(plan);
      f.store.selectRows = optimized;
      // The common bounded path must not materialize the full collection through all().
      f.store.all = () => { throw new Error('full collection read'); };
      if (!details.order && details.filters.every(x=>['eq','in','is'].includes(x.operator)) && !details.filters.some(x=>x.value==='{"a":1,"b":2}')) assert.deepEqual(f.store.execute(plan),expected);
      f.store.all = originalAll;
      assert.deepEqual(f.store.execute(plan), expected);
    }
    const indexes = f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(x=>x.name);
    for (const field of ['id','user_id','status','folder_id']) assert.ok(indexes.includes(`records_${field}`), `${field} lookup index exists`);
  } finally { f.close(); }
});
