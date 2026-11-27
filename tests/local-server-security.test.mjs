import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { LocalWorkspace } from '../desktop/server/store.mjs';
import { startLocalServer } from '../desktop/server/http.mjs';

const withServer = async (routes, run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-http-sec-'));
  const store = new LocalWorkspace(path.join(root, 'data'));
  const web = path.join(root, 'web');
  fs.mkdirSync(web);
  fs.writeFileSync(path.join(web, 'index.html'), '<html>Synthetic</html>');
  const bootstrap = randomBytes(32).toString('hex');
  const local = await startLocalServer({ workspace: store, root: web, bootstrap, routes });
  try {
    const boot = await fetch(`${local.origin}/local/bootstrap`, {
      redirect: 'manual',
      headers: { 'X-Banana-Bootstrap': bootstrap },
    });
    assert.equal(boot.status, 303);
    const cookie = boot.headers.get('set-cookie').split(';')[0];
    await run({ base: local.origin, bootstrap, cookie });
  } finally {
    await local.close();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('same-char-length multibyte bootstrap header and cookie return 401 instead of throwing RangeError (400)', () =>
  withServer({}, async ({ base, bootstrap }) => {
    // 64 Latin-1/UTF-8 characters: string length === 64 === bootstrap.length, but UTF-8 byte length === 128.
    const multibyte = '\u00e9'.repeat(bootstrap.length);
    const cookieName = 'banana_' + bootstrap.slice(0, 12);

    const bootRes = await fetch(`${base}/local/bootstrap`, {
      redirect: 'manual',
      headers: { 'X-Banana-Bootstrap': multibyte },
    });
    assert.equal(bootRes.status, 401);

    const apiRes = await fetch(`${base}/api/workspace-config`, {
      headers: { Cookie: `${cookieName}=${multibyte}` },
    });
    assert.equal(apiRes.status, 401);
  }));

test('inherited Object.prototype properties on /api/ return 404 instead of invoking prototype methods', () =>
  withServer({ ok: (_req, res) => res.status(200).json({ ok: true }) }, async ({ base, cookie }) => {
    for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
      const res = await fetch(`${base}/api/${name}`, {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(1_500),
      });
      assert.equal(res.status, 404, `/api/${name} should return 404`);
    }

    const ok = await fetch(`${base}/api/ok`, { headers: { Cookie: cookie } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
  }));
