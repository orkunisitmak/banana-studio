import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Auth, the task registry, billing and usage logging are stubbed at their import seam; fetch is faked.
const stubs = {
  'auth.js': 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});',
  'providerTasks.js': 'export const requireProviderTask=async()=>true;export const prepareTaskRegistry=async()=>null;export const registerProviderTask=async()=>{};',
  'falBillingCosts.js': 'export const fetchFalRequestCosts=async ids=>new Map(ids.map(id=>[id,0.42]));',
  'h3Usage.js': 'export const recordH3Usage=async()=>{};',
};
const load = async entry => {
  const out = await build({
    entryPoints: [entry], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
    bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /_lib\/(auth|providerTasks|falBillingCosts|h3Usage)\.js$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
      b.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }));
    } }],
  });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;
};
const scale = await load('api/fal-video-scale.ts');
const h3 = await load('api/fal-h3-video.ts');

const poll = async (handler, query, responses) => {
  const oldFetch = globalThis.fetch, oldKey = process.env.FAL_KEY, queue = [...responses], urls = [];
  let status = 0, body;
  try {
    process.env.FAL_KEY = 'synthetic';
    globalThis.fetch = async url => { urls.push(String(url)); const next = queue.shift(); return new Response(JSON.stringify(next.body), { status: next.status }); };
    const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; }, end() { return this; } };
    await handler({ method: 'GET', query, headers: {} }, res);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldKey;
  }
  return { status, body, urls };
};

const failedCompletion = [
  { status: 200, body: { status: 'COMPLETED', error: 'Request timed out', error_type: 'request_timeout' } },
  { status: 504, body: { detail: 'Request timed out', error_type: 'request_timeout' } },
];

test('video scale: a COMPLETED status with an error is a permanent failure', async () => {
  const { status, body, urls } = await poll(scale, { requestId: 'req_1' }, failedCompletion);
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'FAILED', error: 'Request timed out' });
  assert.deepEqual(urls, ['https://queue.fal.run/fal-ai/workflow-utilities/requests/req_1/status']);
});

test('video scale: a COMPLETED status without an error still returns the video', async () => {
  const { body } = await poll(scale, { requestId: 'req_1' }, [
    { status: 200, body: { status: 'COMPLETED' } },
    { status: 200, body: { video: { url: 'https://fal.media/scaled.mp4' } } },
  ]);
  assert.deepEqual(body, { status: 'SUCCEEDED', videoUrl: 'https://fal.media/scaled.mp4' });
});

test('H3: a COMPLETED status with an error is a terminal failure with its billed cost', async () => {
  const { status, body, urls } = await poll(h3, { requestId: 'req_1', endpoint: 'minimax/h3-max' }, failedCompletion);
  assert.equal(status, 200);
  assert.equal(body.status, 'FAILED');
  assert.equal(body.error, 'Request timed out');
  assert.equal(body.actualCostUsd, 0.42);
  assert.deepEqual(urls, ['https://queue.fal.run/minimax/h3-max/requests/req_1/status']);
});

test('H3: a COMPLETED status without an error still returns the video', async () => {
  const { body } = await poll(h3, { requestId: 'req_1', endpoint: 'minimax/h3-max' }, [
    { status: 200, body: { status: 'COMPLETED' } },
    { status: 200, body: { video: { url: 'https://fal.media/h3.mp4' } } },
  ]);
  assert.equal(body.status, 'SUCCEEDED');
  assert.deepEqual(body.output, ['https://fal.media/h3.mp4']);
});
