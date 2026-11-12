import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const out = await build({
  entryPoints: ['./api/youtube.ts'],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /[\\/]_lib[\\/]auth(\.js)?$/ }, () => ({ path: 'auth', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const applyCors = () => {}; export const requireUser = async () => ({ id: "u1" });', loader: 'js' }));
  } }],
});
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

process.env.YOUTUBE_API_KEY = 'test-key';
const call = async (status, body) => {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', body: { endpoint: 'channels', params: { part: 'snippet', id: 'UC123' } }, headers: {} }, res);
  return res;
};

test('a plain YouTube error message is forwarded unchanged', async () => {
  const res = await call(400, { error: { message: "Invalid value for parameter 'id'." } });
  assert.equal(res.body.error, "Invalid value for parameter 'id'.");
});

test('quota exceeded reaches the dialog as plain text', async () => {
  const res = await call(403, { error: { message: 'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.' } });
  assert.equal(res.code, 403);
  assert.equal(res.body.error, 'The request cannot be completed because you have exceeded your quota.');
});

test('a markup-only message falls back to the status text', async () => {
  const res = await call(403, { error: { message: '<br/>' } });
  assert.equal(res.body.error, 'YouTube API error (403)');
});
