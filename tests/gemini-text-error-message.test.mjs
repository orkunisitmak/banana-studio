import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const req = createRequire(import.meta.url);
const out = await build({
  entryPoints: ['./api/gemini-generate.ts'],
  absWorkingDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /[\\/]_lib[\\/]auth(\.js)?$/ }, () => ({ path: 'auth', namespace: 'stub' }));
    b.onResolve({ filter: /^@google[\\/]genai$/ }, () => ({ path: 'file://' + req.resolve('@google/genai'), external: true }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const applyCors = () => {}; export const requireUser = async () => ({ id: "u1" });', loader: 'js' }));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

process.env.GEMINI_API_KEY = 'test-key';
const sentence = 'You exceeded your current quota, please check your plan and billing details.';
const quota = { error: { code: 429, message: sentence, status: 'RESOURCE_EXHAUSTED' } };
globalThis.fetch = async () => new Response(JSON.stringify(quota), { status: 429, headers: { 'content-type': 'application/json' } });
console.error = console.info = console.log = () => {};
const call = async accept => {
  const res = { code: 0, body: null, chunks: [], setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
    write(s) { this.chunks.push(s); }, end() { return this; }, on() {}, off() {} };
  await handler({ method: 'POST', headers: accept ? { accept } : {}, body: { model: 'gemini-3.8-flash', contents: { parts: [{ text: 'enhance this' }] } } }, res);
  return res;
};

test('JSON response: a Gemini 429 shows the provider sentence and keeps the status', async () => {
  const res = await call();
  assert.equal(res.code, 429);
  assert.equal(res.body.error, sentence);
});

test('streaming response: the error event carries the sentence, not the JSON body', async () => {
  const res = await call('application/x-ndjson');
  const event = res.chunks.map(line => JSON.parse(line)).find(e => e.type === 'error');
  assert.equal(event?.error, sentence);
});
