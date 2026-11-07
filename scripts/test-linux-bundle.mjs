import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Run the packaged workspace test on Linux x86_64.');
const app = fs.realpathSync(process.argv[2] || '.build/linux-x64/BananaStudio');
const runtime = path.join(app, 'resources/runtime/bin/node');
if (fs.realpathSync(process.execPath) !== runtime) {
  execFileSync(runtime, [import.meta.filename, app], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: 'inherit' });
  process.exit(0);
}
assert.equal(process.versions.node, '24.19.0');
const load = name => import(pathToFileURL(path.join(app, 'resources/app', name)).href);
const { workspaceResources } = await load('resources.mjs');
const { WorkspaceProcess } = await load('workspace.mjs');
const { bootstrapSession } = await load('bootstrap.mjs');
const resources = workspaceResources({ packaged: true, resourcesPath: path.join(app, 'resources'), developmentRoot: '/not-a-checkout', runtime: '/not-system-node' });
const { default: sharp } = await import(pathToFileURL(path.join(resources.cwd, 'node_modules/sharp/dist/index.mjs')).href);
const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]);
const png = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(), pixels);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-packaged-test-'));
let child, identity;
try {
  for (const round of [0, 1]) {
    const bootstrap = randomBytes(32).toString('hex');
    child = new WorkspaceProcess({ runtime: resources.runtime, server: resources.server,
      launch: { dataDirectory: directory, webRoot: resources.web, bootstrap, keys: {} },
    });
    const origin = await child.start(); let sessionCookie;
    await bootstrapSession(origin, bootstrap, { async set(cookie) { sessionCookie = `${cookie.name}=${cookie.value}`; } });
    const headers = { Cookie: sessionCookie };
    const config = await (await fetch(origin + '/api/workspace-config', { headers })).json();
    if (identity) assert.equal(config.userId, identity); else identity = config.userId;
    assert.equal((await fetch(origin + '/local/health')).status, 401);
    assert.equal((await fetch(origin + '/', { headers })).status, 200);
    const query = async plan => {
      const response = await fetch(origin + '/local/query', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(plan) });
      assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.error, null); return value.data;
    };
    if (round === 0) {
      await query({ table: 'folders', operation: 'insert', value: { id: 'synthetic-folder', name: 'Packaged persistence' } });
      const uploaded = await fetch(origin + '/local/upload', { method: 'POST', headers: { ...headers, Origin: origin, 'X-Media-Path': 'refs/synthetic.png' }, body: png });
      assert.equal(uploaded.status, 200);
      await query({ table: 'reference_images', operation: 'insert', value: { id: 'synthetic-reference', name: 'Synthetic', url: origin + '/storage/v1/object/authenticated/media/refs/synthetic.png' } });
    }
    const folders = await query({ table: 'folders', operation: 'select', columns: '*', filters: [{ column: 'id', operator: 'eq', value: 'synthetic-folder' }] });
    assert.equal(folders[0].name, 'Packaged persistence');
    const refs = await query({ table: 'reference_images', operation: 'select', columns: '*', filters: [{ column: 'id', operator: 'eq', value: 'synthetic-reference' }] });
    assert.ok(refs[0].url.startsWith(origin + '/'));
    assert.deepEqual(Buffer.from(await (await fetch(refs[0].url, { headers })).arrayBuffer()), png);
    assert.equal((await fetch(origin + '/local/query', { method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' }, body: '{}' })).status, 403);
    await child.stop(); assert.equal(child.child.exitCode, 0);
  }
  // EOF before startup completion must not leave a listening orphan process.
  const eof = spawn(runtime, [resources.server], { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
  eof.stdout.resume(); eof.stderr.resume(); eof.stdin.on('error', () => {});
  const exited = new Promise((resolve, reject) => { eof.once('exit', resolve); eof.once('error', reject); });
  eof.stdin.end(JSON.stringify({ dataDirectory: directory, webRoot: resources.web, bootstrap: randomBytes(32).toString('hex'), keys: {} }) + '\n');
  let deadline;
  try { await Promise.race([exited, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Workspace survived launch-pipe EOF.')), 5000); })]); assert.equal(eof.exitCode, 0); }
  finally { clearTimeout(deadline); if (eof.exitCode === null && eof.signalCode === null) { eof.kill('SIGKILL'); await exited; } }
  console.log('Packaged Linux Node 24.19.0, sharp/libvips, auth, frontend, folder/reference persistence and clean restart passed. No provider was contacted. GUI/keyring/sandbox acceptance is separate.');
} finally { await child?.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
