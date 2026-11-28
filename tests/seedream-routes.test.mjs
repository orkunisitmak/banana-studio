import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Real validators and route orchestration. Only the authenticated storage,
// ledger, registry, and HTTP transports are replaced; nothing can buy media.
const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = {};
globalThis.__seedreamRoutes = fixture;
const sources = {
  auth: `export const createUserScopedClient=()=>({}); export const applyCors=()=>{};
    export async function requireUser(req,res){if(req.headers.authorization==='Bearer owner')return {id:'owner'};res.status(401).end();return null;}`,
  providerConfiguration: 'export const admitProvider=async()=>"fal";',
  openaiGuard: `export async function startPaidRequest(_req,res,user,kind,provider){f.events.push(['admit',user.id,kind,provider]);if(f.denied){res.status(429).end();return null;}return {finish:async outcome=>{f.events.push(['finish',outcome]);}};}`,
  providerTasks: `export async function prepareTaskRegistry(){f.events.push(['registry']);return {from:()=>({insert:async row=>{f.row=row;return {};}})};}
    export async function registerProviderTask(_db,provider,id,user){f.events.push(['register',provider,id,user]);}
    export async function requireProviderTask(_req,res,provider,id){f.events.push(['owner',provider,id]);if(f.owns)return true;res.status(404).end();return false;}`,
  seedreamResultStorage: `export class SeedreamArchiveRejected extends Error {}
    export async function readArchivedSeedreamResult(){f.events.push(['cache']);return f.cached;}
    export async function archiveSeedreamResult(_db,owner,id,endpoint,result){f.events.push(['archive',owner,id,endpoint]);f.raw=result;return f.cached=f.result;}`,
};
const bundled = await build({ stdin: { contents: `export {default as generate} from './api/fal-image-generate.ts';export {default as status} from './api/fal-status.ts';`, resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'offline-seedream-routes', setup(b) {
  b.onResolve({ filter: /(?:^|\/)(auth|providerConfiguration|openaiGuard|providerTasks|seedreamResultStorage)\.js$/ }, ({ path }) => ({ path: path.split('/').at(-1).slice(0, -3), namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: `const f=globalThis.__seedreamRoutes;\n${sources[path]}` }));
} }] });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const base = 'bytedance/seedream/v5.5';
const invoke = async (handler, req, authorized = true) => {
  const res = { code: 0, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
  await handler({ ...req, headers: authorized ? { authorization: 'Bearer owner' } : {} }, res);
  return res;
};
const setup = t => {
  Object.assign(fixture, { events: [], denied: false, owns: true, raw: null, cached: null });
  const previous = process.env.FAL_KEY;
  process.env.FAL_KEY = 'offline-key';
  t.after(() => { if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous; });
};
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const refs = ['https://ref.test/1.png', 'https://ref.test/2.png'];
const common = { output_format: 'png', watermark: true, sync_mode: true, enable_safety_checker: false };
const examples = {
  'text-to-image': { prompt: 'flowers', image_size: 'auto_1.5K', num_images: 6, background: 'transparent', ...common },
  edit: { prompt: 'Blend image 1 and image 2', image_urls: refs, image_size: { width: 1280, height: 720 }, num_images: 2, background: 'opaque', ...common },
  layerize: { image_url: refs[0], image_size: 'auto', max_images: 30, enable_text_recognition: true, ...common },
};
for (const [mode, input] of Object.entries(examples)) test(`guarded ${mode} submission forwards exactly its documented inputs`, async t => {
  setup(t);
  const endpoint = `${base}/${mode}`;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    fixture.events.push(['submit', url]);
    assert.equal(options.headers.Authorization, 'Key offline-key');
    assert.deepEqual(JSON.parse(options.body), input);
    return json({ request_id: 'job' });
  });
  const res = await invoke(api.generate, { method: 'POST', body: { endpoint, input } });
  assert.equal(res.code, 200);
  assert.equal(res.body.endpoint,endpoint); assert.equal(res.body.requestId,'job'); assert.equal(res.body.generationId,fixture.row.id); assert.equal(fixture.row.task_id,'job'); assert.equal(fixture.row.user_id,'owner');
  assert.deepEqual(fixture.events, [['registry'], ['admit', 'owner', 'image', 'fal.ai'], ['submit', `https://queue.fal.run/${endpoint}`], ['finish', 'completed'], ['register', 'fal', 'job', 'owner']]);
});

test('authentication, per-mode schema and paid admission reject before dispatch', async t => {
  setup(t);
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unreachable'); });
  const post = (mode, input, authorized) => invoke(api.generate, { method: 'POST', body: { endpoint: `${base}/${mode}`, input } }, authorized);
  assert.equal((await post('edit', examples.edit, false)).code, 401);
  for (const [mode, input] of [
    ['edit', { ...examples.edit, image_urls: Array(11).fill(refs[0]) }], ['edit', { ...examples.edit, prompt: '' }],
    ['text-to-image', { ...examples['text-to-image'], image_urls: refs }], ['text-to-image', { ...examples['text-to-image'], num_images: 7 }],
    ['layerize', { ...examples.layerize, webhookUrl: 'https://unwanted.test' }], ['layerize', { ...examples.layerize, image_url: undefined }],
  ]) assert.equal((await post(mode, input)).code, 400);
  assert.deepEqual(fixture.events, []);
  fixture.denied = true;
  assert.equal((await post('layerize', examples.layerize)).code, 429);
  assert.deepEqual(fixture.events, [['registry'], ['admit', 'owner', 'image', 'fal.ai']]);
  assert.equal(network.mock.callCount(), 0);
});

test('status archives large inline results after ownership, returns full layer records and reconnects without provider calls', async t => {
  setup(t);
  const endpoint = `${base}/layerize`, req = { method: 'GET', query: { endpoint, requestId: 'paid-job' } };
  const box = { normalized: [10, 20, 890, 950], absolute: [1, 2, 89, 95] };
  const baseImage = { url: 'https://signed.test/base.jpg', file_name: 'base.jpg', content_type: 'image/jpeg', width: 100, height: 100, file_size: 400 };
  const layerImage = { ...baseImage, url: 'https://signed.test/layer.png', content_type: 'image/png', file_name: 'layer.png' };
  fixture.result = { images: [baseImage, layerImage], layers: [{ z_index: 0, image: baseImage }, { z_index: 1, image: layerImage, name: 'Sign', description: 'Street sign', bounding_box: box,
    text_recognition: { text: 'Main St', lines: [{ bounding_box: box, runs: [{ text: 'Main St', style: { bold: true, foreground_color: '#FF0000' } }] }] } }] };
  const inline = 'data:image/png;base64,' + 'A'.repeat(4_800_000);
  const providerResult = structuredClone(fixture.result);
  providerResult.images[1].url = inline;
  providerResult.layers[1].image.url = inline;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return json(url.endsWith('/status') ? { status: 'COMPLETED' } : providerResult); });
  fixture.owns = false;
  assert.equal((await invoke(api.status, req)).code, 404);
  assert.deepEqual(fixture.events, [['owner', 'fal', 'paid-job']]);
  assert.equal(requests.length, 0);
  fixture.owns = true;
  const first = await invoke(api.status, req);
  assert.equal(first.code, 200);
  assert.deepEqual(first.body, { ...fixture.result, output: [baseImage.url, layerImage.url], status: 'SUCCEEDED', progress: 1 });
  assert.equal(fixture.raw.images[1].url.length, inline.length);
  assert.deepEqual(requests, ['https://queue.fal.run/bytedance/seedream/requests/paid-job/status', 'https://queue.fal.run/bytedance/seedream/requests/paid-job']);
  assert.deepEqual((await invoke(api.status, req)).body, first.body);
  assert.equal(requests.length, 2);
});

test('failed, cancelled, and unavailable queue reads never archive or resubmit a generation', async t => {
  setup(t);
  const req = { method: 'GET', query: { endpoint: `${base}/edit`, requestId: 'paid-job' } };
  for (const [body, http, expected] of [
    [{ status: 'COMPLETED', error: 'Invalid input' }, 200, 'FAILED'],
    [{ status: 'COMPLETED', error_type: 'client_cancelled' }, 200, 'CANCELLED'],
    [{ status: 'NOT_FOUND' }, 404, undefined], [{ detail: 'Rate limited' }, 429, undefined],
  ]) {
    let reads = 0;
    const stub = t.mock.method(globalThis, 'fetch', async url => {
      reads++;
      assert.equal(url, 'https://queue.fal.run/bytedance/seedream/requests/paid-job/status');
      return Response.json(body, { status: http });
    });
    const result = await invoke(api.status, req);
    assert.equal(result.code, http); assert.equal(result.body.status, expected); assert.equal(reads, 1);
    stub.mock.restore();
  }
  assert.equal(fixture.events.some(([kind]) => kind === 'archive'), false);
});


test('completed invalid or oversized Seedream documents are terminal; interrupted reads can reconnect', async t => {
  setup(t);
  const req = {method:'GET',query:{endpoint:base+'/edit',requestId:'paid-handle'}};
  for (const [response,expected] of [
    [new Response('invalid JSON'),200],
    [new Response('oversize',{headers:{'Content-Length':String(161*1024*1024)}}),200],
    [new Response(new ReadableStream({start(controller){controller.error(new Error('transport reset'));}})),502],
  ]) {
    const reads=[];
    const stub=t.mock.method(globalThis,'fetch',async(url,options)=>{
      assert.notEqual(options.method,'POST'); reads.push(url);
      return url.endsWith('/status') ? json({status:'COMPLETED'}) : response;
    });
    const result=await invoke(api.status,req);
    assert.equal(result.code,expected);assert.equal(reads.length,2);
    if (expected===200){assert.equal(result.body.status,'FAILED');assert.equal(result.body.requestId,'paid-handle');}
    else assert.equal(result.body.status,undefined);
    stub.mock.restore();
  }
  assert.equal(fixture.events.some(([kind])=>kind==='archive'),false);
});
