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
const recorder = `const from=table=>{const op={table,op:'select'};const q={select(){return q},update(v){op.op='update';op.value=v;return q},upsert(v){op.op='upsert';op.value=v;return q},insert(v){op.op='insert';op.value=v;return q},
  eq(k,v){(op.where=op.where||{})[k]=v;return q},is(k,v){return q.eq(k,v)},limit(){return q},maybeSingle(){return q},then(ok,fail){globalThis.__ops.push(op);return Promise.resolve(globalThis.__db(op)).then(ok,fail)}};return q;};`;
const seedance = (await bundle('api/seedance-video.ts', {
  'auth.js': `export const applyCors=()=>{};export const requireUser=async()=>({id:'u1'});export const createUserScopedClient=()=>({});${recorder}export const createServiceRoleClient=()=>({from});`,
  '/providerConfiguration.js': 'export const admitProvider=async(_req,_res,_model,provider)=>provider||"fal";export const providerKey=()=>"synthetic";',
  '/imageStorage.js': 'export const signedMediaUrl=async()=>"";',
  '/openaiGuard.js': 'export const startPaidRequest=async()=>({finish:async()=>{}});',
})).default;
const body = { videoModel: 'seedance-2.5', mode: 'reference_to_video', imageUrls: ['https://media.example/ref.png'], prompt: 'a fox', duration: 5, quality: '720p', aspectRatio: '16:9', generationId: 'gen-1' };
const savedRow = () => ({ data: { id: 'gen-1', type: 'video', status: 'pending', task_id: '', metadata: { keep: 'mine' } }, error: null });
const submit = async (request, db = savedRow) => {
  process.env.EVOLINK_API_KEY = 'synthetic'; globalThis.__ops = []; globalThis.__db = db;
  const fetchImpl = globalThis.fetch; let billed = 0;
  const requests = [];
  globalThis.fetch = async (url, init) => { billed++; requests.push([String(url), JSON.parse(init.body)]); return respond(String(url).includes('evolink') ? { id: 'evo_1' } : { request_id: 'fal_1' }); };
  let status = 0, json; const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { json = value; return this; }, end() { return this; } };
  try { await seedance({ method: 'POST', headers: {}, query: {}, body: request }, res); } finally { globalThis.fetch = fetchImpl; }
  return { status, json, billed, requests, saved: globalThis.__ops.find(op => op.table === 'generations' && op.value?.task_id),
    claim: globalThis.__ops.find(op => op.table === 'generations' && op.value?.status === 'processing'), usage: globalThis.__ops.find(op => op.table === 'usage_logs') };
};

test('an accepted Seedance task is saved on the caller\'s gallery row by the server', async () => {
  for (const provider of ['fal', 'evolink']) {
    const result = await submit({ ...body, provider });
    assert.equal(result.status, 200, provider);
    assert.ok(result.saved, `${provider}: task_id was not saved on the gallery row`);
    assert.deepEqual([result.saved.value.task_id, result.saved.where], [result.json.taskId, { id: 'gen-1', user_id: 'u1' }], provider);
    assert.equal(result.claim.value.metadata.generationProvider, provider);
    assert.equal(result.claim.value.metadata.keep, 'mine');
    assert.deepEqual(result.claim.where, { id: 'gen-1', user_id: 'u1', type: 'video', status: 'pending', task_id: '', metadata: JSON.stringify({ keep: 'mine' }) });
  }
  // A failed save returns 503 with the task ID, so the client keeps the paid task.
  const failed = await submit({ ...body, provider: 'fal' }, op => op.table === 'generations' && op.value?.task_id ? { data: null, error: { message: 'timeout' } } : savedRow(op));
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
  const claimed = await submit({ ...body, provider: 'fal' }, op => ({ data: op.table === 'generations' ? { ...savedRow().data, status: 'processing' } : {}, error: null }));
  assert.deepEqual([claimed.status, claimed.billed], [409, 0]);
});

test('fal receives selected Seedance schema and authenticated owner, never client identity or unselected provider options', async () => {
  const result = await submit({ ...body, provider: 'fal', quality: '4K', seed: 0, returnLastFrame: true, codec: 'H265', outputFormat: 'mov', draft: false, task: 'reference', end_user_id: 'other' });
  assert.equal(result.status, 200);
  const [[url, input]] = result.requests;
  assert.equal(url, 'https://queue.fal.run/bytedance/seedance-2.5/us/reference-to-video');
  assert.deepEqual(input, { prompt: 'a fox', resolution: '4k', duration: '5', aspect_ratio: '16:9', generate_audio: true, draft: false, return_last_frame: true, codec: 'H265', output_format: 'mov', end_user_id: 'u1', task: 'reference', image_urls: body.imageUrls, seed: 0 });
  assert.equal(result.usage.value.estimated_cost, null);
  const invalid = await submit({ ...body, provider: 'fal', videoModel: 'seedance-2.0', draft: true });
  assert.deepEqual([invalid.status, invalid.billed], [400, 0]);
});


test('submission distinguishes admission refusal, ambiguous acceptance, and an acknowledged task with a failed gallery save', async () => {
  const { createVideoTask, isRecoverableVideoTaskError } = await bundle('src/services/runwayService.ts', {
    '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
    '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
    '/providerRouting': 'export const selectProvider=()=>"fal";',
  });
  const config = { mode: 'video', videoModel: 'seedance-2.5', prompt: 'a fox', referenceImages: [{ id: 'r1', data: 'https://media.example/ref.png', mimeType: 'image/png' }], referenceVideos: [], referenceAudios: [],
    videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: true, videoOperation: 'generate', count: 1 };
  const fetchImpl = globalThis.fetch; const sent = [];
  const create = async response => { globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return response; };
    try { return (await createVideoTask(config, { id: 'gen-1' })).taskId; }
    catch (error) { return { message: error.message, recoverable: isRecoverableVideoTaskError(error) }; }
    finally { globalThis.fetch = fetchImpl; } };
  assert.equal(await create(respond({ error: 'saved task could not be updated', taskId: 'bs_fal_seedance-2.5_x' }, 503)), 'bs_fal_seedance-2.5_x');
  assert.deepEqual(await create(respond({error:'rejected'},422)), {message:'rejected',recoverable:false});
  const error = 'The selected provider is not available.';
  assert.deepEqual(await create(respond({error,code:'PROVIDER_ADMISSION_REJECTED',providerRequestSent:false},503)), {message:error,recoverable:false});
  for (const receipt of [{error}, {error,code:'SUBMISSION_UNKNOWN'}, {error,code:'PROVIDER_ADMISSION_REJECTED',providerRequestSent:true}]) {
    assert.deepEqual(await create(respond(receipt,503)), {message:error,recoverable:true});
  }
  assert.equal(sent[0].generationId, 'gen-1');
});

test('logical video IDs dispatch to their selected native routes only after references have been saved for the initiating owner', async () => {
  const { createVideoTask } = await bundle('src/services/runwayService.ts', {
    '/authService':'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"token",user:{id:"owner"}}}})}};',
    '/providerRouting':'export const selectProvider=()=>globalThis.__route;',
    '/storageService':'export const refreshMediaAccessUrl=async u=>u; export const uploadBlobToPublicUrl=()=>{throw Error("Unexpected upload")}; export const uploadVideoBlobToPublicUrl=uploadBlobToPublicUrl, uploadBase64ToPublicUrl=uploadBlobToPublicUrl;',
  });
  const base = {prompt:'A jumping fox',videoDuration:5,videoQuality:'720p',videoAspectRatio:'16:9',videoOperation:'generate',referenceImages:[],referenceVideos:[],referenceAudios:[]};
  const realFetch = globalThis.fetch;
  try {
    for (const [videoModel,provider,opts,route,mode] of [
      ['seedance-2.5','fal',{},'/api/seedance-video','text_only'],
      ['seedance-2.0','openrouter',{},'/api/seedance-video','text_only'],
      ['minimax-h3','fal',{h3MaxMode:'text_to_video',videoQuality:'768p'},'/api/fal-h3-video','text_to_video'],
      ['minimax-h3','evolink',{h3MaxMode:'text_to_video',videoQuality:'768p'},'/api/evolink-generate','text_only'],
      ['magi-2','evolink',{magi2Mode:'text_only',videoQuality:'1080p'},'/api/evolink-generate','text_only'],
      ['gemini-omni-1.2-flash','fal',{},'/api/fal-h3-video','text_to_video'],
    ]) {
      globalThis.__route=provider;
      const events=[], config={...base,...opts,videoModel,videoProvider:provider};
      globalThis.fetch = async (path,init) => { const sent=JSON.parse(init.body); events.push('post');
        assert.equal(path,route); assert.equal(sent.videoModel,videoModel); assert.equal(sent.mode,mode); assert.equal(sent.generationId,'gallery');
        return respond({taskId:'paid',usage:{credits_reserved:9},endpoint:'endpoint'});
      };
      const accepted = await createVideoTask(config,{id:'gallery',userId:'owner',savePreparedReferences: async refs=>{ events.push('save'); assert.deepEqual(refs.referenceImages,[]); return true; }});
      assert.deepEqual(events,['save','post']); assert.equal(accepted.provider,provider); assert.equal(accepted.taskId,'paid');
      await assert.rejects(createVideoTask(config,{id:'gallery',userId:'other'}),/Session changed/);
      await assert.rejects(createVideoTask(config,{id:'gallery',userId:'owner',savePreparedReferences:async()=>false}),/No provider request/);
      assert.deepEqual(events,['save','post']);
    }
  } finally { globalThis.fetch=realFetch; delete globalThis.__route; }
});
