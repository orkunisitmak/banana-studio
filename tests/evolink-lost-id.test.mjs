import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});',
  providerTasks: `
    export const prepareTaskRegistry=async()=>({});
    export const registerProviderTask=async()=>{
      if (globalThis.__registerFail) throw new Error('registry down');
    };
  `,
};

const compiled = await build({
  entryPoints: ['api/evolink-generate.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks' : 'auth',
      namespace: 'stub',
    }));
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
const submit = async (fetchImpl, { registerFail = false } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.EVOLINK_API_KEY, fail: globalThis.__registerFail };
  process.env.EVOLINK_API_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler({ method: 'POST', body }, res);
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
