import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Share viewer: the grid is loaded, then the owner deletes (or moves out) one image and a
// visitor clicks it. /api/shared-folder answers with mediaId and the link is still valid,
// but the handler returns the same 404 'This share link is unavailable or expired.' that it
// uses for a dead link, so the viewer tells the visitor the whole link has expired.
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + 'package.json')('esbuild');
const out = await build({ entryPoints: ['./api/shared-folder.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /[\\/]_lib[\\/]auth(\.js)?$/ }, () => ({ path: 'auth', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createServiceRoleClient = () => globalThis.__db;', loader: 'js' }));
  } }] });
const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const future = new Date(Date.now() + 86400000).toISOString();
const dbReturning = data => ({
  rpc: async () => ({ data, error: null }),
  storage: { from: () => ({ createSignedUrls: async paths => ({ data: paths.map(path => ({ path, signedUrl: 'https://s.example/' + path })), error: null }) }) },
});
const call = async (body, data) => {
  globalThis.__db = dbReturning(data);
  const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
};
const token = 'A'.repeat(43);

test('control: an expired or revoked link (no share row) says the link is unavailable or expired', async () => {
  const res = await call({ token }, null);
  assert.equal(res.code, 404);
  assert.match(res.body.error, /share link is unavailable or expired/);
});
test('control: the same live link still lists the remaining images', async () => {
  const res = await call({ token }, { name: 'Trip', expiresAt: future, images: [{ id: 'kept', storagePath: 'u/kept.png', thumbnailPath: null }] });
  assert.equal(res.code, 200);
  assert.equal(res.body.images.length, 1);
});
test('opening an image that was removed from a live shared folder does not say the link expired', async () => {
  const res = await call({ token, mediaId: 'removed' }, { name: 'Trip', expiresAt: future, images: [] });
  assert.doesNotMatch(res.body.error, /share link is unavailable or expired/, `status ${res.code}: ${res.body.error}`);
  assert.equal(res.code, 404);
  assert.match(res.body.error, /image is no longer available/);
});
test('an expired link that no longer has the image still says the link expired', async () => {
  const res = await call({ token, mediaId: 'removed' }, { name: 'Trip', expiresAt: new Date(Date.now() - 1000).toISOString(), images: [] });
  assert.match(res.body.error, /share link is unavailable or expired/);
});
