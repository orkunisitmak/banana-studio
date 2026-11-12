import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Each stub path ends a module specifier.
const bundle = async (entry, stubs) => {
  const compiled = await build({ entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(stub => args.path.endsWith(stub)); return key ? { path: key, namespace: 'stub' } : undefined; });
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      b.onResolve({ filter: /^[^./]/ }, args => ({ path: import.meta.resolve(args.path), external: true }));
    } }] });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });

// Records every query made through the server registry client.
const recorder = `const from=table=>{const op={table,op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},insert(v){op.op='insert';op.value=v;return q},
  eq(k,v){(op.where=op.where||{})[k]=v;return q},limit(){return q},maybeSingle(){return q},then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__db(op)).then(ok,fail)}};return q;};`;
const seedance = (await bundle('api/seedance-video.ts', {
  'auth.js': `export const applyCors=()=>{};export const requireUser=async()=>({id:'u1'});export const createUserScopedClient=()=>({});${recorder}export const createServiceRoleClient=()=>({from});`,
  '/providerConfiguration.js': 'export const chooseProvider=(model,provider)=>provider||"fal";export const providerKey=()=>"synthetic";',
  '/imageStorage.js': 'export const signedMediaUrl=async()=>"";',
})).default;
const body = { videoModel: 'seedance-2.5', mode: 'reference_to_video', imageUrls: ['https://media.example/ref.png'], prompt: 'a fox', duration: 5, quality: '720p', aspectRatio: '16:9', generationId: 'gen-1' };
const savedRow = op => ({ data: { id: 'gen-1', type: 'video' }, error: null });
const submit = async (request, db = savedRow) => {
  process.env.EVOLINK_API_KEY = 'synthetic'; globalThis.__ops = []; globalThis.__db = db;
  const fetchImpl = globalThis.fetch; let billed = 0;
  globalThis.fetch = async url => { billed++; return respond(String(url).includes('evolink') ? { id: 'evo_1' } : { request_id: 'fal_1' }); };
  let status = 0, json; const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { json = value; return this; }, end() { return this; } };
  try { await seedance({ method: 'POST', headers: {}, query: {}, body: request }, res); } finally { globalThis.fetch = fetchImpl; }
  return { status, json, billed, saved: globalThis.__ops.find(op => op.table === 'generations' && op.op === 'update') };
};

test('an accepted Seedance task is saved on the caller\'s gallery row by the server', async () => {
  for (const provider of ['fal', 'evolink']) {
    const result = await submit({ ...body, provider });
    assert.equal(result.status, 200, provider);
    assert.ok(result.saved, `${provider}: task_id was not saved on the gallery row`);
    assert.deepEqual([result.saved.value.task_id, result.saved.where], [result.json.taskId, { id: 'gen-1', user_id: 'u1' }], provider);
  }
  // A failed save returns 503 with the task ID, so the client keeps the paid task.
  const failed = await submit({ ...body, provider: 'fal' }, op => op.table === 'generations' && op.op === 'update' ? { data: null, error: { message: 'timeout' } } : savedRow(op));
  assert.deepEqual([failed.status, failed.json.taskId], [503, 'bs_fal_seedance-2.5_fal_1']);
  assert.equal((await submit({ ...body, provider: 'fal', generationId: '../x' })).status, 400);
  // Requests without a generation ID behave as before.
  const legacy = await submit({ ...body, provider: 'fal', generationId: undefined });
  assert.deepEqual([legacy.status, legacy.saved], [200, undefined]);
});

test('a Seedance submission for a saved video that no longer exists is never sent to the provider', async () => {
  for (const provider of ['fal', 'evolink']) for (const [row, error, expected] of [[null, null, 404], [{ id: 'gen-1', type: 'image' }, null, 404], [null, { message: 'timeout' }, 503]]) {
    const result = await submit({ ...body, provider }, op => op.table === 'generations' ? { data: row, error } : { data: { id: 'x' }, error: null });
    assert.deepEqual([result.status, result.billed], [expected, 0], `${provider} ${JSON.stringify(row)} ${error?.message}`);
  }
});

test('the client keeps an accepted Seedance task when only the gallery save failed', async () => {
  const { createVideoTask } = await bundle('src/services/runwayService.ts', {
    '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
    '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
    '/providerRouting': 'export const selectProvider=()=>"fal";',
  });
  const config = { mode: 'video', videoModel: 'seedance-2.5', prompt: 'a fox', referenceImages: [{ id: 'r1', data: 'https://media.example/ref.png', mimeType: 'image/png' }], referenceVideos: [], referenceAudios: [],
    videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: true, videoOperation: 'generate', count: 1 };
  const fetchImpl = globalThis.fetch; const sent = [];
  const create = async response => { globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return response; };
    try { return (await createVideoTask(config, { id: 'gen-1' })).taskId; } catch (error) { return `error: ${error.message}`; } finally { globalThis.fetch = fetchImpl; } };
  assert.equal(await create(respond({ error: 'saved task could not be updated', taskId: 'bs_fal_seedance-2.5_x' }, 503)), 'bs_fal_seedance-2.5_x');
  assert.equal(await create(respond({ error: 'rejected' }, 422)), 'error: rejected');
  assert.equal(sent[0].generationId, 'gen-1');
});
