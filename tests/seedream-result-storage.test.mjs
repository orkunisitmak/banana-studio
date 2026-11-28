import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../api/_lib/seedreamResultStorage.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm' });
const { archiveSeedreamResult, readArchivedSeedreamResult, SeedreamArchiveRejected } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const url = 'https://workspace.example.invalid';
process.env.SUPABASE_URL = url;
delete process.env.FAL_ADMIN_KEY; // This suite never contacts billing services.
const owner = '11111111-1111-4111-8111-111111111111';
const task = 'accepted-once';
const endpoint = mode => `bytedance/seedream/v5.5/${mode}`;
function fixture(mode, race) {
  const row = { id: 'existing-row', user_id: owner, task_id: task, image_model: 'seedream-5.5', created_at: 1, status: 'processing',
    metadata: { falEndpoint: endpoint(mode), falRequestId: task, seedreamOptions: { mode }, originalPrompt: 'Retain me' } };
  const uploads = new Map();
  const writes = [], removals = [], usage = [];
  let deleted = false;
  let signatures = 0;
  const db = {
    storage: { from: () => ({
      async upload(path, bytes, options) { assert.equal(options.contentType, 'image/png'); uploads.set(path, bytes); return {}; },
      async remove(paths) { removals.push(...paths); for (const path of paths) uploads.delete(path); return {}; },
      async createSignedUrls(paths) { ++signatures; return { data: paths.map(path => ({ path, signedUrl: `${url}/storage/v1/object/sign/media/${path}?token=${signatures}` })) }; },
    }) },
    from(table) {
      if (table === 'usage_logs') return {insert:async record => { assert.equal(record.user_id,owner); assert.equal(record.image_count,row.metadata.seedreamResult.images.length); usage.push(record); return {}; }};
      const filters = {};
      let update;
      return {
        select() { return this; }, eq(k, v) { filters[k] = v; return this; },
        async limit(n) {
          assert.equal(n,1);assert.equal(filters.user_id,owner);assert.equal(filters.task_id,task);
          if (race==='lookup-error') return {data:null,error:{message:'temporary database failure'}};
          return {data:deleted && race!=='rebound'?[]:[{id:row.id}]};
        },
        async maybeSingle() {
          assert.equal(filters.user_id,owner);assert.equal(filters.task_id,task);assert.equal(filters['metadata->>falEndpoint'],endpoint(mode));
          if (!update) return {data:deleted ? null : row};
          if (['deleted','lookup-error','rebound'].includes(race)) {deleted=true;return {data:null};}
          if (race === 'completed') {
            Object.assign(row,update);
            row.metadata.seedreamResult.images[0].file_name='won-by-another-worker.png';
            return {data:null};
          }
          if(row.status==='completed') return {data:null};
          writes.push(update);Object.assign(row,update);return {data:{id:row.id}};
        },
        update(values) { update = values; return this; },
        neq(k, v) { assert.equal(k,'status'); assert.equal(v,'completed'); assert.equal(filters.id,row.id); return this; },
      };
    },
  };
  return { db, row, uploads, writes, removals, usage };
}

for (const mode of ['text-to-image', 'edit', 'layerize']) test(`archives the entire ${mode} result before publishing it; reconnect only signs saved files`, async () => {
  const { db, row, writes, uploads } = fixture(mode);
  const images = [0, 1, 2].map(i => ({ url: png, file_name: `piece-${i}.png`, width: 1, height: 1, file_size: 70, content_type: 'image/png' }));
  const box = { absolute: [0, 0, 1, 1], normalized: [0, 0, 1000, 1000] };
  const ocr = { text: 'Hello', lines: [{ bounding_box: box, runs: [{ text: 'Hello', style: { bold: true, italic: true, similar_font_family: 'Arial', foreground_color: '#FFFFFF' } }] }] };
  const result = mode === 'layerize' ? { images, layers: images.map((image, i) => i === 0 ? { image, z_index: 0 } :
    { image, z_index: i, bounding_box: box, name: `layer ${i}`, description: `Letters ${i}`, text_recognition: ocr }) } : { images };
  assert.equal(await readArchivedSeedreamResult(db, owner, task, endpoint(mode)), null);
  const response = await archiveSeedreamResult(db, owner, task, endpoint(mode), result);
  assert.equal(uploads.size, 3, 'archive once per output, not twice for the flattened layer list');
  assert.equal(writes.length, 1); assert.equal(row.status, 'completed'); assert.equal(row.metadata.originalPrompt, 'Retain me');
  assert.equal(row.metadata.seedreamResult.images.length, 3);
  assert.doesNotMatch(JSON.stringify(row), /base64|token=|\/object\/sign\//);
  const resumed = await readArchivedSeedreamResult(db, owner, task, endpoint(mode));
  assert.equal(writes.length, 1); assert.notEqual(resumed.images[0].url, response.images[0].url);
  assert.deepEqual(resumed.images.map(({url, ...file}) => file), images.map(({url, ...file}) => file));
  if (result.layers) {
    for (const [i, layer] of resumed.layers.entries()) {
      assert.equal(layer.image.url, resumed.images[i].url);
      assert.deepEqual({ ...layer, image: images[i] }, result.layers[i]);
    }
  }
});

test('incomplete, non-raster or unsafe output never completes a gallery row', async () => {
  for (const result of [{ images: [{ url: png }], layers: [] },
    ...['data:text/html;base64,QUJD', 'data:image/png;base64,QUJD', 'https://127.0.0.1/private'].map(url => ({images: [{ url }], layers: [{ image: { url }, z_index: 0 }]}))]) {
    const { db, row, writes } = fixture('layerize');
    await assert.rejects(archiveSeedreamResult(db, owner, task, endpoint('layerize'), result),SeedreamArchiveRejected);
    assert.equal(writes.length, 0); assert.equal(row.status, 'processing');
  }
});

test('rejects layer stacks without a base at zero and increasing z_index through 99', async () => {
  const image = { url: png };
  for (const indices of [[1], [0, 0], [0, 2, 1], [0, 100]]) {
    const { db, uploads } = fixture('layerize');
    const result = { images: indices.map(() => image), layers: indices.map(z_index => ({ image, z_index })) };
    await assert.rejects(archiveSeedreamResult(db, owner, task, endpoint('layerize'), result), /incomplete/);
    assert.equal(uploads.size, 0);
  }
});

test('hosted PNGs are fetched from the CDN without credentials; interrupted archive retries the existing task', async () => {
  const { db, row, uploads, writes } = fixture('edit');
  const images = ['one', 'two'].map(name => ({ url: `https://v3b.fal.media/files/${name}.png` }));
  const original = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url.hostname, 'v3b.fal.media'); assert.equal(options.redirect, 'error'); assert.equal(options.headers, undefined);
    if (fail && url.pathname.endsWith('two.png')) return new Response('not ready', { status: 503 });
    return new Response(Buffer.from(png.split(',')[1], 'base64'));
  };
  try {
    await assert.rejects(archiveSeedreamResult(db, owner, task, endpoint('edit'), { images }));
    assert.equal(row.status, 'processing'); assert.equal(writes.length, 0);
    fail = false;
    await archiveSeedreamResult(db, owner, task, endpoint('edit'), { images });
    assert.equal(row.status, 'completed'); assert.equal(writes.length, 1); assert.equal(uploads.size, 2);
  } finally { globalThis.fetch = original; }
});

test('archive accounting accepts only the charged request and endpoint, including a real zero',async t=>{
  process.env.FAL_ADMIN_KEY='synthetic-billing';t.after(()=>{delete process.env.FAL_ADMIN_KEY;});
  const route=endpoint('text-to-image'),{db,row}=fixture('text-to-image');
  const billing=t.mock.method(globalThis,'fetch',async(value,init)=>{
    const url=new URL(value);assert.equal(url.pathname,'/v1/models/billing-events');
    assert.equal(url.searchParams.get('request_id'),task);assert.equal(url.searchParams.get('endpoint_id'),route);assert.equal(init.headers.Authorization,'Key synthetic-billing');
    return Response.json({has_more:false,next_cursor:null,billing_events:[
      {request_id:task,endpoint_id:route,cost_total:'0'}, {request_id:task,endpoint_id:route+'/other',cost_total:'50'}, {request_id:'not-ours',endpoint_id:route,cost_total:'90'},
    ]});
  });
  await archiveSeedreamResult(db,owner,task,route,{images:[{url:png}]});
  assert.deepEqual(row.metadata.generationCost,{usd:0,source:'provider_actual'});
  await readArchivedSeedreamResult(db,owner,task,route);assert.equal(billing.mock.callCount(),1);
});

test('a gallery deletion during finalization removes only staged files and never reports success or logs usage',async()=>{
  const {db,uploads,writes,removals,usage}=fixture('edit','deleted');
  const unrelated=owner+'/seedream/other-task/0.png';uploads.set(unrelated,'other');
  await assert.rejects(archiveSeedreamResult(db,owner,task,endpoint('edit'),{images:[{url:png},{url:png}]}),/no longer owns this task/);
  assert.deepEqual([...uploads.keys()],[unrelated]);assert.equal(removals.length,2);assert.equal(writes.length,0);assert.equal(usage.length,0);
});

test('a concurrent completed manifest wins the response without duplicate billing or deleting winner files',async()=>{
  const {db,uploads,writes,removals,usage}=fixture('edit','completed');
  const result=await archiveSeedreamResult(db,owner,task,endpoint('edit'),{images:[{url:png,file_name:'candidate.png'}]});
  assert.equal(result.images[0].file_name,'won-by-another-worker.png');assert.match(result.images[0].url,/token=2$/);
  assert.equal(uploads.size,1);assert.equal(removals.length,0);assert.equal(writes.length,0);assert.equal(usage.length,0);
});

test('lost binding is not permission to delete a live task, and inconclusive lookups stay retryable',async()=>{
  for (const race of ['rebound','lookup-error']) {
    const {db,uploads,removals,usage}=fixture('edit',race);
    await assert.rejects(archiveSeedreamResult(db,owner,task,endpoint('edit'),{images:[{url:png}]}),error=>{
      if(race==='rebound')return error instanceof SeedreamArchiveRejected;
      return !(error instanceof SeedreamArchiveRejected) && /confirm deletion/.test(error.message);
    });
    assert.equal(uploads.size,1);assert.equal(removals.length,0);assert.equal(usage.length,0);
  }
});
