import test from 'node:test';
import assert from 'node:assert/strict';
const { build } = await import('esbuild');
const { fileURLToPath } = await import('node:url');
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({});',
  providerTasks: `
    export const prepareTaskRegistry=async()=>({});
    export const registerProviderTask=async()=>{
      if (globalThis.__registerFail) throw new Error('registry down');
      globalThis.__registered = (globalThis.__registered || 0) + 1;
    };
    export const requireProviderTask=async()=>true;
  `,
  evolink: 'export default async()=>{throw new Error("evolink unused");};',
  imageStorage: 'export const signedMediaUrl=async()=>"https://signed";',
};
const compiled = await build({
  entryPoints: ['api/seedance-video.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks|imageStorage)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks' : args.path.includes('imageStorage') ? 'imageStorage' : 'auth',
      namespace: 'stub',
    }));
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
const seedanceBody = { videoModel: 'seedance-2.0', provider: 'fal', mode: 'text_only', prompt: 'hi', duration: 5, quality: '720p', aspectRatio: '16:9' };
const submit = async (fetchImpl, { registerFail = false } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY, fail: globalThis.__registerFail };
  process.env.FAL_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler({ method: 'POST', body: seedanceBody }, res);
    return res;
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.FAL_KEY = previous.key;
    globalThis.__registerFail = previous.fail;
  }
};
const jsonResponse = (status, body) => async () => ({
  ok: status < 300, status, json: async () => body,
});

test('a registry failure after Seedance accepts keeps the registry message and returns no task id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'abc' }), { registerFail: true });
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /registry down/);
  assert.equal(res.body.retryable, false);
  assert.equal(res.body.taskId, undefined);
});

test('a Seedance HTTP error does not return a task id', async () => {
  const res = await submit(jsonResponse(400, { error: 'bad' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.taskId, undefined);
});

test('a successful Seedance submission returns the task id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'ok1' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.taskId, 'bs_fal_seedance-2.0_ok1');
});
