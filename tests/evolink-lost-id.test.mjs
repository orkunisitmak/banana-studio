import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stubs = {
  guard: 'export const startPaidRequest=async()=>({finish:async()=>{}});',
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});',
  providerTasks: `
    export const prepareTaskRegistry=async()=>({});
    export const registerProviderTask=async()=>{
      if (globalThis.__registerFail) throw new Error('registry down');
    };
    export const isGenerationId=()=>true;
    export const requireSavedVideo=async()=>true;
    export const saveGenerationTask=async()=>true;
  `,
};

const compiled = await build({
  entryPoints: ['api/evolink-generate.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /providerConfiguration\.js$/ }, () => ({ path: 'admission', namespace: 'video-provider' }));
    b.onLoad({ filter: /.*/, namespace: 'video-provider' }, () => ({ contents: 'export const admitProvider=async (_req,_res,_model,provider)=>provider;export const providerKey=()=>"testing";' }));
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks' : 'auth',
      namespace: 'stub',
    }));
    b.onResolve({ filter: /(^|\/)openaiGuard\.js$/ }, () => ({ path: 'guard', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => (
      args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true }
    ));
  } }],
});
const { default: handler } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const response = () => {
  const res = { statusCode: 0, body: undefined, status(code) { res.statusCode = code; return res; }, json(body) { res.body = body; return res; }, end() { return res; }, setHeader() {} };
  return res;
};
const body = { mode: 'text_only', prompt: 'hi', duration: 5, quality: '720p', videoModel: 'seedance-2.5' };
const submit = async (fetchImpl, { registerFail = false, request = body } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.EVOLINK_API_KEY, fail: globalThis.__registerFail };
  process.env.EVOLINK_API_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler({ method: 'POST', body: request }, res);
    return res;
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.EVOLINK_API_KEY = previous.key;
    globalThis.__registerFail = previous.fail;
  }
};
const jsonResponse = (status, payload) => async () => ({
  ok: status < 300, status, json: async () => payload,
});

test('a registry failure after EvoLink accepts still returns the task id', async () => {
  const res = await submit(jsonResponse(200, { id: 'evo-1' }), { registerFail: true });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.taskId, 'evo-1');
});

test('an EvoLink HTTP error does not return a task id', async () => {
  const res = await submit(jsonResponse(400, { error: { message: 'bad' } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.taskId, undefined);
});

test('an EvoLink response without id does not return a task id', async () => {
  const res = await submit(jsonResponse(200, {}));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.taskId, undefined);
});

test('a successful EvoLink submission returns the task id', async () => {
  const res = await submit(jsonResponse(200, { id: 'evo-2' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskId, 'evo-2');
});

const media = 'https://media.example.com/';
const paidRequest = async request => {
  const submissions = [];
  const res = await submit(async (url, options) => {
    submissions.push(JSON.parse(options.body));
    return jsonResponse(200, { id: 'receipt-1', usage: { credits_reserved: 9 } })();
  }, { request });
  return { res, submissions };
};

test('MAGI-2 chooses each EvoLink endpoint and never sends local duration hints upstream', async () => {
  for (const [mode, fields, expected] of [
    ['text_only', {}, 'text-to-video'],
    ['image_to_video', { imageUrls: [media+'first.png', media+'end.png'], aspectRatio: 'adaptive' }, 'image-to-video'],
    ['reference_to_video', { videoUrls: [media+'input.mp4'], videoDurations: [10], audioUrls: [media+'track.mp3'], audioDurations: [5] }, 'reference-to-video'],
  ]) {
    const { res, submissions } = await paidRequest({ videoModel: 'magi-2', mode, prompt: 'A sailboat', duration: 30, generateAudio: false, ...fields });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.endpoint, 'evolink/magi-2-'+expected);
    assert.equal(res.body.provider, 'evolink');
    assert.deepEqual(res.body.usage, { credits_reserved: 9 });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].model, 'magi-2-'+expected);
    assert.equal(submissions[0].quality, '1080p');
    assert.equal(submissions[0].generate_audio, false);
    assert.equal(submissions[0].aspect_ratio, mode === 'image_to_video' ? 'auto' : '16:9');
    assert.equal(submissions[0].videoDurations, undefined);
    if (fields.videoUrls) assert.deepEqual(submissions[0].video_urls, fields.videoUrls);
  }
});

test('MAGI-2 rejects caller callbacks, private URLs and overlong references before submitting', async () => {
  for (const extra of [{callback_url: media+'hook'}, {imageUrls: ['https://127.0.0.1/a']}, {videoUrls:[media+'in.mp4'], videoDurations:[31]}]) {
    const { res, submissions } = await paidRequest({ videoModel:'magi-2', mode:'reference_to_video', prompt:'test', ...extra });
    assert.equal(res.statusCode, 400); assert.deepEqual(submissions, []);
  }
});

test('EvoLink H3 routes frame pairs without fal options and rejects unsupported resolution', async () => {
  const request = { videoModel:'minimax-h3', mode:'image_to_video', prompt:'Pan', duration:6, quality:'768p', imageUrls:[media+'a.png',media+'b.png'] };
  const { res, submissions } = await paidRequest(request);
  assert.equal(res.statusCode,200);
  assert.deepEqual(submissions,[{ model:'minimax-h3-max-image-to-video', prompt:'Pan', duration:6, quality:'768p', image_start:request.imageUrls[0], image_end:request.imageUrls[1] }]);
  for (const invalid of [{ quality:'1080p' }, { options:{useTargetAudio:true} }]) {
    const failure = await paidRequest({...request,...invalid});
    assert.equal(failure.res.statusCode,400); assert.deepEqual(failure.submissions,[]);
  }
});

test('EvoLink Seedance emits lowercase 4k and rejects excessive total duration before charging', async () => {
  const { res, submissions } = await paidRequest({...body, quality:'4K'});
  assert.equal(res.statusCode,200); assert.equal(submissions[0].quality,'4k');
  const invalid = await paidRequest({...body, mode:'reference_to_video', videoUrls:[media+'a.mp4',media+'b.mp4'], videoDurations:[29,5]});
  assert.equal(invalid.res.statusCode,400); assert.deepEqual(invalid.submissions,[]);
});
