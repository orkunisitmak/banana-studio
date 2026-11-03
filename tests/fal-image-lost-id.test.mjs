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
      globalThis.__registered = (globalThis.__registered || 0) + 1;
    };
  `,
};

const out = await build({
  entryPoints: ['api/fal-image-generate.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [{
    name: 'stubs',
    setup(b) {
      b.onResolve({ filter: /\/_lib\/(auth|providerTasks)\.js$/ }, args => ({
        path: args.path.includes('providerTasks') ? 'providerTasks' : 'auth',
        namespace: 'stub',
      }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        contents: stubs[args.path],
        loader: 'js',
      }));
      b.onResolve({ filter: /^[^./]/ }, args => (
        args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true }
      ));
    },
  }],
});

const { default: handler } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
);

const response = () => {
  const res = {
    statusCode: 0,
    body: undefined,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { return res; },
    setHeader() {},
  };
  return res;
};

const submit = async (fetchImpl, { registerFail = false } = {}) => {
  const previous = { fetch: globalThis.fetch, key: process.env.FAL_KEY, fail: globalThis.__registerFail, registered: globalThis.__registered };
  process.env.FAL_KEY = 'test-key';
  globalThis.__registerFail = registerFail;
  globalThis.__registered = 0;
  globalThis.fetch = fetchImpl;
  const res = response();
  try {
    await handler(
      { method: 'POST', body: { endpoint: 'fal-ai/nano-banana-pro', prompt: 'hi' } },
      res,
    );
    res.registered = globalThis.__registered;
    return res;
  } finally {
    globalThis.fetch = previous.fetch;
    process.env.FAL_KEY = previous.key;
    globalThis.__registerFail = previous.fail;
    globalThis.__registered = previous.registered;
  }
};

const jsonResponse = (status, body) => async () => ({
  ok: status < 300,
  status,
  text: async () => JSON.stringify(body),
});

test('a registry failure after fal accepts still returns the task id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'fal-req-1' }), { registerFail: true });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.taskId, 'fal-req-1');
});

test('a fal HTTP error does not return a task id', async () => {
  const res = await submit(jsonResponse(400, { message: 'bad prompt' }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.taskId, undefined);
  assert.equal(res.registered, 0);
});

test('a fal response without request_id does not return a task id', async () => {
  const res = await submit(jsonResponse(200, {}));
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.taskId, undefined);
});

test('a successful submission returns the request id', async () => {
  const res = await submit(jsonResponse(200, { request_id: 'fal-req-2' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requestId, 'fal-req-2');
});
