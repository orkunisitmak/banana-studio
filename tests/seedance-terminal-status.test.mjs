import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'stubs',
    setup(b) {
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
    },
  }],
});

const { default: handler } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const poll = async (taskId, reply) => {
  const previous = { fetch: globalThis.fetch, fal: process.env.FAL_KEY, or: process.env.OPENROUTER_API_KEY };
  process.env.FAL_KEY = 'test-fal';
  process.env.OPENROUTER_API_KEY = 'test-or';
  globalThis.fetch = async () => reply;
  const res = {
    statusCode: 0,
    body: undefined,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { return res; },
    setHeader() {},
  };
  try {
    await handler({ method: 'GET', query: { taskId } }, res);
    return res;
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.FAL_KEY = previous.fal;
    process.env.OPENROUTER_API_KEY = previous.or;
  }
};

test('fal ERROR status returns terminal FAILED instead of RUNNING forever', async () => {
  const res = await poll('bs_fal_seedance-2.5_req1', { ok: true, status: 200, json: async () => ({ status: 'ERROR' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'FAILED');
});

test('fal CANCELLED and OpenRouter canceled statuses return terminal CANCELLED instead of RUNNING', async () => {
  const falRes = await poll('bs_fal_seedance-2.5_req2', { ok: true, status: 200, json: async () => ({ status: 'CANCELLED' }) });
  assert.equal(falRes.statusCode, 200);
  assert.equal(falRes.body.status, 'CANCELLED');

  const orRes = await poll('bs_openrouter_seedance-2.0_req3', { ok: true, status: 200, json: async () => ({ status: 'canceled' }) });
  assert.equal(orRes.statusCode, 200);
  assert.equal(orRes.body.status, 'CANCELLED');
});

test('OpenRouter error and expired statuses return terminal FAILED instead of RUNNING', async () => {
  const errRes = await poll('bs_openrouter_seedance-2.0_req4', { ok: true, status: 200, json: async () => ({ status: 'error' }) });
  assert.equal(errRes.statusCode, 200);
  assert.equal(errRes.body.status, 'FAILED');

  const expRes = await poll('bs_openrouter_seedance-2.0_req4b', { ok: true, status: 200, json: async () => ({ status: 'expired' }) });
  assert.equal(expRes.statusCode, 200);
  assert.equal(expRes.body.status, 'FAILED');
});

test('non-JSON, null, array, or statusless 200 responses return retryable 502 instead of fake RUNNING', async () => {
  const nonJson = await poll('bs_fal_seedance-2.5_req5', {
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  });
  assert.equal(nonJson.statusCode, 502);
  assert.equal(nonJson.body.retryable, true);

  for (const payload of [null, [], {}, { status: null }, { status: '' }, { error: 'boom' }]) {
    const res = await poll('bs_fal_seedance-2.5_req5b', { ok: true, status: 200, json: async () => payload });
    assert.equal(res.statusCode, 502, JSON.stringify(payload));
    assert.equal(res.body.retryable, true, JSON.stringify(payload));
  }
});

test('lowercase cancelled status maps to terminal CANCELLED', async () => {
  const res = await poll('bs_openrouter_seedance-2.0_req5c', { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'CANCELLED');
});

test('control: IN_QUEUE and IN_PROGRESS still return RUNNING with expected progress', async () => {
  const queued = await poll('bs_fal_seedance-2.5_req6', { ok: true, status: 200, json: async () => ({ status: 'IN_QUEUE' }) });
  assert.deepEqual(queued.body, { status: 'RUNNING', progress: 0.05 });

  const running = await poll('bs_fal_seedance-2.5_req7', { ok: true, status: 200, json: async () => ({ status: 'IN_PROGRESS' }) });
  assert.deepEqual(running.body, { status: 'RUNNING', progress: 0.5 });
});
