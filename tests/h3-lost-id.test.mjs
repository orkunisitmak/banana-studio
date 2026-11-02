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
    b.onResolve({ filter: /\/_lib\/(auth|providerTasks|h3Usage|falBillingCosts)\.js$/ }, args => ({
      path: args.path.includes('providerTasks') ? 'providerTasks'
        : args.path.includes('h3Usage') ? 'h3Usage'
        : args.path.includes('falBillingCosts') ? 'falBilling'
        : 'auth',
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
const submit = async (fetchImpl, { registerFail = false } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY, fail: globalThis.__registerFail };
  process.env.FAL_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler({ method: 'POST', body: { prompt: 'a cat', mode: 'text_to_video' } }, res);
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
  assert.equal(res.body.error, 'registry down');
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
