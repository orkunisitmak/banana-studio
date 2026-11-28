import test from 'node:test';
import assert from 'node:assert/strict';
const { build } = await import('esbuild');
const { fileURLToPath } = await import('node:url');
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({});',
  guard: 'export const startPaidRequest=async()=>({finish:async()=>{}});',
  providerTasks: 'export const prepareTaskRegistry=async()=>({});export const registerProviderTask=async()=>{};export const requireProviderTask=async()=>true;export const isGenerationId=()=>true;export const requireSavedVideo=async()=>true;export const saveGenerationTask=async()=>true;',
  evolink: 'export default async()=>{throw new Error("evolink unused");};',
  imageStorage: 'export const signedMediaUrl=async()=>"https://signed";',
};
const compiled = await build({
  entryPoints: ['api/seedance-video.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /providerConfiguration\.js$/ }, () => ({ path: 'admission', namespace: 'video-provider' }));
    b.onLoad({ filter: /.*/, namespace: 'video-provider' }, () => ({ contents: 'export const admitProvider=async (_req,_res,_model,provider)=>provider;export const providerKey=()=>"testing";' }));
    b.onResolve({ filter: /seedanceUsage\.js$/ }, () => ({ path: 'billing', namespace: 'seedance-billing' }));
    b.onLoad({ filter: /.*/, namespace: 'seedance-billing' }, () => ({ contents: 'export const recordSeedanceUsage=async()=>{};export const seedanceActualCost=async()=>0.42;' }));
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks|imageStorage)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks' : args.path.includes('imageStorage') ? 'imageStorage' : 'auth',
      namespace: 'stub',
    }));
    b.onResolve({ filter: /(^|\/)openaiGuard\.js$/ }, () => ({ path: 'guard', namespace: 'stub' }));
    b.onResolve({ filter: /\/evolink-generate\.js$/ }, () => ({ path: 'evolink', namespace: 'stub' }));
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
const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });
const poll = async (routes) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY };
  const calls = [];
  process.env.FAL_KEY = 'test-key';
  globalThis.fetch = async url => {
    calls.push(String(url));
    const route = routes[String(url).endsWith('/status') ? 'status' : 'result'];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route;
  };
  const res = response();
  try {
    await handler({ method: 'GET', query: { taskId: 'bs_fal_seedance-2.0_req1' } }, res);
    return { res, calls };
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.FAL_KEY = previous.key;
  }
};

test('a fal Seedance task that completes with an error fails instead of waiting for a result', async () => {
  const { res, calls } = await poll({
    status: reply(200, { status: 'COMPLETED', error: 'Content policy violation', error_type: 'runner_server_error' }),
    result: reply(500, { detail: 'Content policy violation' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'FAILED');
  assert.match(res.body.error, /Content policy violation/);
  assert.equal(res.body.actualCostUsd, 0.42);
  assert.equal(calls.length, 1);
});

test('a completed fal Seedance task without an error still returns its video', async () => {
  const { res, calls } = await poll({
    status: reply(200, { status: 'COMPLETED' }),
    result: reply(200, { video: { url: 'https://v3.fal.media/files/out.mp4' }, duration: 8, seed: 0, draft_id: 'draft-1', last_frame: { url: 'https://v3.fal.media/files/frame.jpg' } }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: 'SUCCEEDED', output: ['https://v3.fal.media/files/out.mp4'], actualCostUsd: 0.42, duration: 8, seed: 0, draftId: 'draft-1', lastFrameUrl: 'https://v3.fal.media/files/frame.jpg' });
  assert.equal(calls.length, 2);
});
