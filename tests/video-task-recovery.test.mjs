import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// Each stub path ends a module specifier; records writes made through the server registry client.
const bundle = async (entry, stubs, expose = []) => {
  const compiled = await build({entryPoints:[entry],absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'node',
    plugins:[{name:'stubs',setup(b){
      b.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(stub=>args.path.endsWith(stub));return key?{path:key,namespace:'stub'}:undefined;});
      b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
      // Match the file name only: Windows paths use backslashes.
      if(expose.length)b.onLoad({filter:new RegExp('[\\\\/]'+entry.split('/').pop().replace(/[.]/g,'\\.')+'$')},args=>({contents:fs.readFileSync(args.path,'utf8')+`\nexport { ${expose.join(',')} };`,loader:'ts'}));
      b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('Video Edit preprocessing rides out transient poll errors but stops on real failures', async () => {
  const { normalizeVideoForEdit } = await bundle('src/services/runwayService.ts', {
    '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
    '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
    '/providerRouting': 'export const selectProvider=()=>"evolink";',
  }, ['normalizeVideoForEdit']);
  const timer = globalThis.setTimeout, fetchImpl = globalThis.fetch;
  globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
  const poll = async responses => { const queue = [...responses]; globalThis.fetch = async () => queue.shift();
    try { return await normalizeVideoForEdit('https://v/in.mp4', 1280, 720); } catch (error) { return `error: ${error.message}`; } };
  try {
    const submit = () => respond({ requestId: 'scale_1' }), done = () => respond({ status: 'SUCCEEDED', videoUrl: 'https://v/out.mp4' });
    assert.equal(await poll([submit(), respond({ error: 'busy' }, 429), respond({ error: 'gateway' }, 502), done()]), 'https://v/out.mp4');
    assert.equal(await poll([submit(), ...Array.from({ length: 5 }, () => respond({ error: 'down' }, 503))]), 'error: down');
    assert.equal(await poll([submit(), respond({ error: 'missing' }, 404)]), 'error: missing');
  } finally { globalThis.setTimeout = timer; globalThis.fetch = fetchImpl; }
});

test('the client keeps an accepted Seedance task when only the gallery save failed', async () => {
  const { createVideoTask } = await bundle('src/services/runwayService.ts', {
    '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
    '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
    '/providerRouting': 'export const selectProvider=()=>"fal";',
  });
  const config = { mode: 'video', videoModel: 'seedance-2.5', prompt: 'a fox', referenceImages: [], referenceVideos: [], referenceAudios: [],
    videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: true, videoOperation: 'generate', count: 1 };
  const fetchImpl = globalThis.fetch;
  const submit = async response => { globalThis.fetch = async () => response;
    try { return (await createVideoTask(config, { id: 'gen-1' })).taskId; } catch (error) { return `error: ${error.message}`; } finally { globalThis.fetch = fetchImpl; } };
  assert.equal(await submit(respond({ error: 'saved task could not be updated', taskId: 'bs_fal_seedance-2.5_x' }, 503)), 'bs_fal_seedance-2.5_x');
  assert.equal(await submit(respond({ error: 'rejected' }, 422)), 'error: rejected');
});

test('an accepted Seedance task is saved on the caller\'s gallery row by the server', async () => {
  const recorder = `const from=table=>{const op={table,op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},insert(v){op.op='insert';op.value=v;return q},
    eq(k,v){(op.where=op.where||{})[k]=v;return q},limit(){return q},maybeSingle(){return q},then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__db(op)).then(ok,fail)}};return q;};`;
  const stubs = {
    'auth.js': `export const applyCors=()=>{};export const requireUser=async()=>({id:'u1'});export const createUserScopedClient=()=>({});${recorder}export const createServiceRoleClient=()=>({from});`,
    '/providerConfiguration.js': 'export const chooseProvider=(model,provider)=>provider||"fal",providerKey=()=>"key";',
    '/imageStorage.js': 'export const signedMediaUrl=async()=>"";',
  };
  const seedance = (await bundle('api/seedance-video.ts', stubs)).default;
  const fetchImpl = globalThis.fetch;
  const submit = async (body, db = () => ({ data: { id: 'row', type: 'video' }, error: null })) => {
    process.env.FAL_KEY = process.env.EVOLINK_API_KEY = 'synthetic'; globalThis.__ops = []; globalThis.__db = db;
    globalThis.fetch = async url => respond(String(url).includes('evolink') ? { id: 'evo_1' } : { request_id: 'fal_1' });
    let status = 0, json; const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { json = value; return this; }, end() { return this; } };
    try { await seedance({ method: 'POST', headers: {}, query: {}, body }, res); } finally { globalThis.fetch = fetchImpl; }
    return { status, json, saved: globalThis.__ops.find(op => op.table === 'generations' && op.op === 'update') };
  };
  const body = { videoModel: 'seedance-2.5', mode: 'text_only', prompt: 'a fox', duration: 5, quality: '720p', aspectRatio: '16:9', generationId: 'gen-1' };
  for (const provider of ['fal', 'evolink']) {
    const result = await submit({ ...body, provider });
    assert.equal(result.status, 200, provider);
    assert.deepEqual([result.saved.value.task_id, result.saved.where], [result.json.taskId, { id: 'gen-1', user_id: 'u1' }], provider);
  }
  const failed = await submit({ ...body, provider: 'fal' }, op => op.table === 'generations' && op.op === 'update' ? { data: null, error: { message: 'timeout' } } : { data: { id: 'x', type: 'video' }, error: null });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.taskId, 'bs_fal_seedance-2.5_fal_1');
  assert.equal((await submit({ ...body, provider: 'fal', generationId: '../x' })).status, 400);
});

test('a Seedance submission for a saved video that no longer exists is never sent to the provider', async () => {
  const recorder = `const from=table=>{const op={table,op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},insert(v){op.op='insert';op.value=v;return q},
    eq(k,v){(op.where=op.where||{})[k]=v;return q},limit(){return q},maybeSingle(){return q},then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__db(op)).then(ok,fail)}};return q;};`;
  const seedance = (await bundle('api/seedance-video.ts', {
    'auth.js': `export const applyCors=()=>{};export const requireUser=async()=>({id:'u1'});export const createUserScopedClient=()=>({});${recorder}export const createServiceRoleClient=()=>({from});`,
    '/providerConfiguration.js': 'export const chooseProvider=(model,provider)=>provider||"fal",providerKey=()=>"key";',
    '/imageStorage.js': 'export const signedMediaUrl=async()=>"";',
  })).default;
  const fetchImpl = globalThis.fetch;
  for (const provider of ['fal', 'evolink']) for (const [row, error, expected] of [[null, null, 404], [{ id: 'gen-1', type: 'image' }, null, 404], [null, { message: 'timeout' }, 503]]) {
    process.env.FAL_KEY = process.env.EVOLINK_API_KEY = 'synthetic'; globalThis.__ops = []; let billed = 0;
    globalThis.__db = op => op.table === 'generations' ? { data: row, error } : { data: { id: 'x' }, error: null };
    globalThis.fetch = async () => { billed++; return respond({ id: 'evo_1', request_id: 'fal_1' }); };
    let status = 0; const res = { setHeader() {}, status(value) { status = value; return this; }, json() { return this; }, end() { return this; } };
    try { await seedance({ method: 'POST', headers: {}, query: {}, body: { provider, videoModel: 'seedance-2.5', mode: 'text_only', prompt: 'a fox', duration: 5, quality: '720p', aspectRatio: '16:9', generationId: 'gen-1' } }, res); }
    finally { globalThis.fetch = fetchImpl; }
    assert.deepEqual([status, billed], [expected, 0], `${provider} ${JSON.stringify(row)} ${error?.message}`);
    assert.deepEqual(globalThis.__ops.find(op => op.table === 'generations').where, { id: 'gen-1', user_id: 'u1' });
  }
});
