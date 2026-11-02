import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { MODEL_ROUTES, resolveProvider } from '../src/lib/providers.ts';
import { liquidSeedanceInput, liquidVideoSize, seedanceProviderError } from '../src/lib/video/seedanceProviders.ts';

const request = (extra = {}) => ({ videoModel: 'seedance-2.5', mode: 'image_to_video', prompt: 'Move from @IMAGE_1 to @IMAGE_2.', duration: 8, quality: '720p', aspectRatio: '16:9', generateAudio: true,
  imageUrls: ['https://example.invalid/first.png', 'https://example.invalid/last.png'], ...extra });

test('Liquid Inference is the last Seedance 2.5 route and never serves Seedance 2.0', () => {
  assert.deepEqual(MODEL_ROUTES['seedance-2.5'], ['evolink', 'fal', 'openrouter', 'liquid']);
  assert.equal(resolveProvider('seedance-2.5', 'auto', { liquid: true }), 'liquid');
  assert.equal(resolveProvider('seedance-2.5', 'auto', { liquid: true, openrouter: true }), 'openrouter');
  assert.throws(() => resolveProvider('seedance-2.0', 'liquid', { liquid: true }));
  assert.ok(seedanceProviderError('liquid', request({ videoModel: 'seedance-2.0' })));
});

test('Liquid sizes keep the chosen ratio within the exchange 1% start-frame check', () => {
  const ratios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '21:9': 21 / 9 };
  for (const quality of ['480p', '720p', '1080p']) for (const [aspect, ratio] of Object.entries(ratios)) {
    const [w, h] = liquidVideoSize(quality, aspect).split('x').map(Number);
    assert.equal(Math.min(w, h), Number.parseInt(quality));
    assert.equal(w % 2 + h % 2, 0);
    assert.ok(Math.abs(w / h - ratio) / ratio < 0.01, `${quality} ${aspect}`);
  }
  assert.equal(liquidVideoSize('720p', '16:9'), '1280x720');
  assert.equal(liquidVideoSize('1080p', '9:16'), '1080x1920');
  assert.throws(() => liquidVideoSize('720p', 'adaptive'));
});

test('Liquid requests use exchange names, frames and references in the documented shape', () => {
  const frames = liquidSeedanceInput(request());
  assert.equal(frames.model, 'seedance-2-5');
  assert.equal(frames.seconds, '8');
  assert.equal(frames.size, '1280x720');
  assert.equal(frames.prompt, 'Move from @Image1 to @Image2.');
  assert.deepEqual(frames.frame_images.map(image => [image.frame_type, image.image_url.url]), [['first_frame', 'https://example.invalid/first.png'], ['last_frame', 'https://example.invalid/last.png']]);
  assert.equal(frames.input_references, undefined);
  const refs = liquidSeedanceInput(request({ mode: 'reference_to_video', aspectRatio: '9:16' }));
  assert.equal(refs.frame_images, undefined);
  assert.equal(refs.input_references.length, 2);
  assert.equal(refs.size, '720x1280');
  const text = liquidSeedanceInput(request({ mode: 'text_only', imageUrls: [] }));
  assert.equal(text.frame_images, undefined); assert.equal(text.input_references, undefined);
});

test('unsupported Liquid options fail before submission', () => {
  assert.equal(seedanceProviderError('liquid', request()), undefined);
  for (const extra of [{ duration: 11 }, { duration: -1 }, { aspectRatio: 'adaptive' }, { mode: 'video_edit', videoUrls: ['https://example.invalid/source.mp4'] },
    { mode: 'reference_to_video', audioUrls: ['https://example.invalid/a.mp3'] }, { mode: 'reference_to_video', imageUrls: Array(10).fill('https://example.invalid/x.png') }]) {
    assert.ok(seedanceProviderError('liquid', request(extra)), JSON.stringify(extra));
  }
  assert.equal(seedanceProviderError('liquid', request({ quality: '1080p', duration: 10 })), undefined);
});

// Route test: auth, task registry, storage and keys are stubbed; upstream fetch is mocked.
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({storage:{from:()=>({createSignedUrl:async()=>({error:{message:"missing"}}),upload:async(path,bytes)=>{globalThis.__saved.push([path,bytes.length]);return {error:null};}})}});',
  providerConfiguration: 'export const chooseProvider=()=>"liquid";export const providerKey=()=>"synthetic-test-value";',
  providerTasks: 'export const prepareTaskRegistry=async()=>({});export const registerProviderTask=async(w,p,id)=>{globalThis.__tasks.push([p,id]);};export const requireProviderTask=async(req,res,p,id)=>{globalThis.__checked.push([p,id]);return true;};',
  'evolink-generate': 'export default async()=>{throw new Error("unexpected");};',
  imageStorage: 'export const signedMediaUrl=async(b,path)=>"https://storage.invalid/"+path;',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ entryPoints: ['api/seedance-video.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, args => ({ path: args.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true });
  } }] });
const { default: seedanceVideo } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const run = async (req, upstream) => {
  const sent = []; Object.assign(globalThis, { __saved: [], __tasks: [], __checked: [] });
  globalThis.fetch = async (url, init = {}) => { sent.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }); return upstream(String(url)); };
  let status = 200, payload;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { payload = value; return this; }, end() { return this; } };
  await seedanceVideo({ headers: {}, query: {}, ...req }, res);
  return { status, payload, sent };
};

test('Liquid video route submits, polls and copies the finished file without exposing the key', async () => {
  process.env.LIQUID_API_KEY = 'synthetic-test-value';
  try {
    const created = await run({ method: 'POST', body: request() }, () => Response.json({ id: 'job_abc123', object: 'video', status: 'in_progress' }));
    assert.equal(created.status, 200, JSON.stringify(created.payload));
    assert.equal(created.sent[0].url, 'https://router.inference.ai.exchange/v1/videos');
    assert.equal(created.sent[0].headers.Authorization, 'Bearer synthetic-test-value');
    assert.equal(created.sent[0].body.model, 'seedance-2-5');
    assert.equal(created.payload.taskId, 'bs_liquid_seedance-2.5_job_abc123');
    assert.deepEqual(globalThis.__tasks, [['liquid', 'bs_liquid_seedance-2.5_job_abc123']]);

    const running = await run({ method: 'GET', query: { taskId: created.payload.taskId } }, () => Response.json({ id: 'job_abc123', status: 'in_progress' }));
    assert.deepEqual(running.payload, { status: 'RUNNING', progress: 0.5 });
    assert.deepEqual(globalThis.__checked, [['liquid', created.payload.taskId]]);

    const done = await run({ method: 'GET', query: { taskId: created.payload.taskId } }, url => url.endsWith('/content')
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } })
      : Response.json({ id: 'job_abc123', status: 'completed', exchange: { charge: { total_usd: 1.65 }, video_seconds: 8 } }));
    assert.equal(done.sent[1].url, 'https://router.inference.ai.exchange/v1/videos/job_abc123/content');
    assert.deepEqual(done.payload, { status: 'SUCCEEDED', output: ['https://storage.invalid/u1/liquid-video/job_abc123.mp4'], actualCostUsd: 1.65 });
    assert.deepEqual(globalThis.__saved, [['u1/liquid-video/job_abc123.mp4', 3]]);
    assert.ok(!JSON.stringify(done.payload).includes('synthetic-test-value'));

    const failed = await run({ method: 'GET', query: { taskId: created.payload.taskId } }, () => Response.json({ id: 'job_abc123', status: 'failed', error: { message: 'x' } }));
    assert.equal(failed.payload.status, 'FAILED');
  } finally { delete process.env.LIQUID_API_KEY; }
});
