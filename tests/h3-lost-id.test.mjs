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
      if (globalThis.__registerFail) throw new Error('Generation was submitted but its private task could not be recorded (Task: h3-1). Contact an administrator before retrying.');
    };
    export const requireProviderTask=async()=>true;
  `,
  h3Usage: 'export const recordH3Usage=async()=>{};',
  falBilling: 'export const fetchFalRequestCosts=async()=>null;',
};

const compiled = await build({
  entryPoints: ['api/fal-h3-video.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /providerConfiguration\.js$/ }, () => ({ path: 'admission', namespace: 'video-provider' }));
    b.onLoad({ filter: /.*/, namespace: 'video-provider' }, () => ({ contents: 'export const admitProvider=async (_req,_res,_model,provider)=>provider;export const providerKey=()=>"testing";' }));
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks|h3Usage|falBillingCosts)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks'
        : args.path.includes('h3Usage') ? 'h3Usage'
        : args.path.includes('falBillingCosts') ? 'falBilling'
        : 'auth',
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
const submit = async (fetchImpl, { registerFail = false, body = {prompt:'a cat', mode:'text_to_video'} } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY, fail: globalThis.__registerFail };
  process.env.FAL_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler({ method: 'POST', body }, res);
    return res;
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.FAL_KEY = previous.key;
    globalThis.__registerFail = previous.fail;
  }
};
const jsonResponse = (status, body) => async () => ({
  ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

test('a registry failure after H3 accepts keeps the server message and returns no task id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'h3-1' }), { registerFail: true });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /\(Task: h3-1\)/);
  assert.match(res.body.error, /Contact an administrator/);
  assert.equal(res.body.taskId, undefined);
});

test('an H3 HTTP error does not return a task id', async () => {
  const res = await submit(jsonResponse(400, { message: 'bad' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad');
  assert.equal(res.body.taskId, undefined);
});

test('an H3 response without request_id does not return a task id', async () => {
  const res = await submit(jsonResponse(200, {}));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'fal.ai response missing request_id');
  assert.equal(res.body.taskId, undefined);
});

test('a successful H3 submission returns the task id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'h3-2' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskId, 'h3-2');
});

const capture = async body => {
  let calls = [];
  const res = await submit(async (url, options) => {
    calls.push({url, input:JSON.parse(options.body)});
    // Even a response from fal cannot move lifecycle requests onto another app.
    return jsonResponse(200,{request_id:'r1', status_url:'https://queue.fal.run/minimax/h3-max/requests/r1/status'})();
  }, {body});
  return {res, calls};
};

test('Omni owns six subroutes and uses its parent queue for recovery', async () => {
  const root = 'https://queue.fal.run/google/gemini-omni-flash', video = 'https://media.example.com/source.mp4', image = 'https://media.example.com/first.png';
  for (const [mode, fields, suffix, expected] of [
    ['text_to_video', {aspectRatio:'16:9',duration:12}, 'text-to-video', {aspect_ratio:'16:9',duration:12}],
    ['image_to_video', {aspectRatio:'9:16',duration:8,imageUrls:[image],endImageUrl:image}, 'image-to-video', {aspect_ratio:'9:16',duration:8,image_url:image,end_image_url:image}],
    ['reference_to_video',{aspectRatio:'16:9',duration:6,videoUrls:[video]},'reference-to-video',{aspect_ratio:'16:9',duration:6,reference_video_urls:[video]}],
    ['edit',{videoUrls:[video]},'edit',{video_url:video}],
    ['extend',{duration:7,videoUrls:[video]},'extend',{duration:7,video_url:video}],
    ['upscale',{videoUrls:[video]},'upscale',{video_url:video}],
  ]) {
    const {res,calls} = await capture({videoModel:'gemini-omni-1.2-flash', mode, prompt:'Sailboat',resolution:'4K',...fields});
    assert.equal(res.statusCode,200); assert.equal(res.body.queueEndpoint,'google/gemini-omni-flash');
    assert.deepEqual(calls,[{url:root+'/v1.2/'+suffix,input:{resolution:'4k',...(mode==='upscale'?{}:{prompt:'Sailboat'}),...expected}}]);
  }
});

test('Omni rejects durations unsupported with an end frame before charging', async () => {
  const image = 'https://media.example.com/a.png';
  const {res,calls} = await capture({videoModel:'gemini-omni-1.2-flash',mode:'image_to_video',duration:12,aspectRatio:'16:9',resolution:'720p',prompt:'Pan',imageUrls:[image],endImageUrl:image});
  assert.equal(res.statusCode,400); assert.deepEqual(calls,[]);
});

test('H3 reference target soundtrack is not billed or sent as reference audio', async () => {
  const audio = 'https://media.example.com/a.mp3', image='https://media.example.com/a.png';
  const base = {videoModel:'minimax-h3',mode:'reference_to_video',prompt:'Pan',duration:6,audioUrls:[audio],imageUrls:[image],options:{useTargetAudio:true}, mediaMetadata:{audios:[{duration:24,size:4096}]}};
  const {res,calls} = await capture(base);
  assert.equal(res.statusCode,200); assert.equal(calls[0].input.target_audio_url,audio); assert.equal(calls[0].input.reference_audio_urls,undefined);
  const invalid = await capture({...base,audioUrls:[audio,audio]});
  assert.equal(invalid.res.statusCode,400); assert.deepEqual(invalid.calls,[]);
});
