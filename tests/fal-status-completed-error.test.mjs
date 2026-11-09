import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Auth and the task registry are stubbed at their import seam; fetch is faked.
const stubs = {
  'auth.js': 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});',
  'providerTasks.js': 'export const requireProviderTask=async()=>true;',
};
const compiled = await build({
  entryPoints: ['api/fal-status.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /_lib\/(auth|providerTasks)\.js$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true }));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const poll = async responses => {
  const oldFetch = globalThis.fetch, oldKey = process.env.FAL_KEY, queue = [...responses], urls = [];
  let status = 0, body;
  try {
    process.env.FAL_KEY = 'synthetic';
    globalThis.fetch = async url => { urls.push(String(url)); const next = queue.shift(); return new Response(JSON.stringify(next.body), { status: next.status }); };
    const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; }, end() { return this; } };
    await handler({ method: 'GET', query: { requestId: 'req_1', endpoint: 'openai/gpt-image-2/edit' }, headers: {} }, res);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = oldKey;
  }
  return { status, body, urls };
};

test('a COMPLETED status with an error is a permanent failure, not a retryable result error', async () => {
  const { status, body, urls } = await poll([
    { status: 200, body: { status: 'COMPLETED', error: 'The runner encountered an internal server error.', error_type: 'runner_server_error' } },
    { status: 500, body: { detail: 'The runner encountered an internal server error.' } },
  ]);
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'FAILED', error: 'The runner encountered an internal server error.', progress: 0 });
  assert.deepEqual(urls, ['https://queue.fal.run/openai/gpt-image-2/requests/req_1/status']);
});

test('a COMPLETED status without an error still returns the generated images', async () => {
  const { status, body, urls } = await poll([
    { status: 200, body: { status: 'COMPLETED', metrics: { inference_time: 3 } } },
    { status: 200, body: { images: [{ url: 'https://fal.media/out.png' }] } },
  ]);
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'SUCCEEDED', output: ['https://fal.media/out.png'], progress: 1 });
  assert.equal(urls[1], 'https://queue.fal.run/openai/gpt-image-2/requests/req_1');
});
