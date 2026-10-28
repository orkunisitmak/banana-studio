import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { directories, localOrigin, approvedSender, secureStorage, childEnvironment, workspaceURL } from '../desktop/linux/security.mjs';
import { Vault } from '../desktop/linux/vault.mjs';
import { WorkspaceProcess } from '../desktop/linux/workspace.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'banana-linux-test-'));
test('XDG directories accept only absolute overrides', () => {
  assert.deepEqual(directories({ XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: 'relative' }, '/home/user'), {
    data: '/data/banana-studio', config: '/home/user/.config/banana-studio', cache: '/home/user/.cache/banana-studio',
  });
  assert.deepEqual(Object.keys(childEnvironment()).sort(), ['LANG', 'PATH']);
});
test('only exact loopback origins and the owning main frame can invoke native actions', () => {
  for (const value of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://127.0.0.1', 'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://127.0.0.1:1234/']) assert.equal(localOrigin(value), false);
  const origin = 'http://127.0.0.1:1234';
  assert.equal(localOrigin(origin), true);
  const contents = { mainFrame: { url: origin + '/' } };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(approvedSender(event, contents, origin), true);
  assert.equal(approvedSender({ ...event, sender: {} }, contents, origin), false);
  assert.equal(approvedSender({ ...event, senderFrame: { url: origin } }, contents, origin), false);
  contents.mainFrame.url = `blob:${origin}/synthetic`;
  assert.equal(approvedSender(event, contents, origin), false);
  contents.mainFrame.url = 'https://example.invalid';
  assert.equal(approvedSender(event, contents, origin), false);
});
test('vault refuses unavailable, unknown and basic_text storage before any disk write', () => {
  const directory = fixture();
  try {
    for (const backend of ['basic_text', 'unknown', 'new_backend', '']) {
      const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend };
      assert.throws(() => new Vault(directory, storage).save({ OPENAI_API_KEY: 'synthetic' }), /Secure Linux/);
      assert.throws(() => new Vault(directory, storage).read(), /Secure Linux/);
    }
    assert.throws(() => secureStorage({ isEncryptionAvailable: () => false }), /Secure Linux/);
    assert.deepEqual(fs.readdirSync(directory), []);
    const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: value => Buffer.from(value).map(byte => byte ^ 42), decryptString: value => Buffer.from(value).map(byte => byte ^ 42).toString() };
    const vault = new Vault(directory, storage);
    assert.deepEqual(vault.read(), {});
    vault.save({ OPENAI_API_KEY: 'synthetic-test-only' });
    assert.ok(!fs.readFileSync(vault.file).includes('synthetic-test-only'));
    assert.deepEqual(vault.read(), { OPENAI_API_KEY: 'synthetic-test-only' });
    assert.throws(() => vault.save({ UNKNOWN_KEY: 'synthetic' }));
    assert.throws(() => vault.save({ FAL_KEY: 'invalid\nkey' }));
    if (process.platform !== 'win32') assert.equal(fs.statSync(vault.file).mode & 0o777, 0o600);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('workspace startup, pipe key refresh and orderly EOF shutdown use a separate Node', async () => {
  const directory = fixture();
  const server = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
const io=readline.createInterface({input:process.stdin});
io.once('line',line=>{const launch=JSON.parse(line);if(launch.bootstrap!=='synthetic'||process.env.NODE_OPTIONS||process.env.OPENAI_API_KEY)process.exit(1);console.log(JSON.stringify({event:'ready',origin:'http://127.0.0.1:12345'}));});
io.on('close',()=>process.exit(0));`);
  const workspace = new WorkspaceProcess({ runtime: process.execPath, server, launch: { bootstrap: 'synthetic' } });
  try {
    assert.equal(await workspace.start(), 'http://127.0.0.1:12345');
    assert.equal(workspace.launch, undefined);
    await workspace.send({ action: 'keys', keys: {} });
    await workspace.stop(); await workspace.stop();
    assert.equal(workspace.child.exitCode, 0);
    await assert.rejects(workspace.send({}));
  } finally { await workspace.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('workspace handles spawn failure, premature exit, invalid origin and timeout', async () => {
  const directory = fixture();
  try {
    const missing = new WorkspaceProcess({ runtime: path.join(directory, 'missing'), server: '', launch: {} });
    await assert.rejects(missing.start(), /failed to start/);
    for (const source of ['process.exit(2)', `console.log(JSON.stringify({event:'ready',origin:'https://attacker.invalid'}));setInterval(()=>{},1000);`, 'setInterval(()=>{},1000)']) {
      const server = path.join(directory, 'fixture.mjs'); fs.writeFileSync(server, source);
      const workspace = new WorkspaceProcess({ runtime: process.execPath, server, launch: {}, timeout: 100, stopTimeout: 100 });
      await assert.rejects(workspace.start());
      assert.ok(workspace.child.exitCode !== null || workspace.child.signalCode !== null);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('unexpected server exit notifies once; shutdown kills an unresponsive server', async () => {
  const directory = fixture();
  try {
    const server = path.join(directory, 'fixture.mjs');
    fs.writeFileSync(server, `console.log(JSON.stringify({event:'ready',origin:'http://127.0.0.1:12345'}));setTimeout(()=>process.exit(1),100);`);
    let notified;
    const failed = new Promise(resolve => { notified = resolve; });
    const workspace = new WorkspaceProcess({ runtime: process.execPath, server, launch: {}, onFailure: notified });
    await workspace.start(); await failed; await workspace.stop();
    fs.writeFileSync(server, `console.log(JSON.stringify({event:'ready',origin:'http://127.0.0.1:12345'}));setInterval(()=>{},1000);`);
    const stuck = new WorkspaceProcess({ runtime: process.execPath, server, launch: {}, stopTimeout: 50 });
    await stuck.start(); await stuck.stop(); assert.equal(stuck.child.signalCode, 'SIGKILL');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Linux raster uses sharp and preserves RGBA PNG pixels with no Mac helper', { skip: process.platform !== 'linux' }, async () => {
  const { decodeRaster, encodeRasterPNG } = await import('../desktop/server/rasterCodec.mjs');
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]);
  const png = await encodeRasterPNG(pixels, 2, 1);
  const decoded = await decodeRaster(png);
  assert.equal(decoded.info.width, 2); assert.equal(decoded.info.height, 1); assert.equal(decoded.info.channels, 4);
  assert.deepEqual(decoded.data, pixels);
  await assert.rejects(decodeRaster(Buffer.from('invalid image')));
});
test('main-process bootstrap imports only an HttpOnly cookie; unauthenticated and cross-origin requests stay denied', async () => {
  const { LocalWorkspace } = await import('../desktop/server/store.mjs');
  const { startLocalServer } = await import('../desktop/server/http.mjs');
  const { bootstrapSession } = await import('../desktop/linux/bootstrap.mjs');
  const directory = fixture(); const store = new LocalWorkspace(path.join(directory, 'data'));
  const bootstrap = 'a'.repeat(64);
  const local = await startLocalServer({ workspace: store, root: directory, bootstrap });
  try {
    assert.equal((await fetch(local.origin + '/api/workspace-config')).status, 401);
    let cookie;
    await assert.rejects(bootstrapSession(local.origin, 'b'.repeat(64), { set() { assert.fail(); } }), /authentication failed/);
    await bootstrapSession(local.origin, bootstrap, { async set(value) { cookie = value; } });
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'strict');
    const headers = { Cookie: `${cookie.name}=${cookie.value}` };
    const response = await fetch(local.origin + '/api/workspace-config', { headers });
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(bootstrap));
    assert.equal((await fetch(local.origin + '/local/query', { method: 'POST', headers: { ...headers, Origin: 'https://example.invalid' }, body: '{}' })).status, 403);
  } finally { await local.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('navigation allows only credential-free HTTP workspace pages, never blob documents', () => {
  const origin = 'http://127.0.0.1:12345';
  assert.equal(workspaceURL(origin + '/?view=gallery#item', origin), true);
  for (const value of [`blob:${origin}/synthetic`, 'data:text/html,synthetic', 'https://example.invalid', 'http://user@127.0.0.1:12345/', 'invalid']) {
    assert.equal(workspaceURL(value, origin), false);
  }
});

test('closing during startup settles the launch and reaps the child without reporting failure', { timeout: 3000 }, async () => {
  const directory = fixture();
  let failures = 0;
  const server = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(server, 'setInterval(()=>{},1000)');
  const workspace = new WorkspaceProcess({ runtime: process.execPath, server, launch: {}, stopTimeout: 50, onFailure() { failures++; } });
  try {
    const rejected = assert.rejects(workspace.start(), /startup cancelled/);
    await workspace.stop(); await rejected;
    assert.ok(workspace.child.exitCode !== null || workspace.child.signalCode !== null);
    assert.equal(failures, 0);
    await assert.rejects(workspace.start(), /already started or closed/);
    const stopped = new WorkspaceProcess({ runtime: process.execPath, server, launch: {} });
    await stopped.stop(); await assert.rejects(stopped.start(), /closed/);
    assert.equal(stopped.child, undefined);
  } finally { await workspace.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('oversized child diagnostics fail closed without returning their content', async () => {
  const directory = fixture(); const server = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(server, "console.log('synthetic-private-output'.repeat(500));setInterval(()=>{},1000)");
  const workspace = new WorkspaceProcess({ runtime: process.execPath, server, launch: {}, stopTimeout: 50 });
  try { await assert.rejects(workspace.start(), { message: 'Invalid workspace startup response.' }); }
  finally { await workspace.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bootstrap validates response cookies, refuses redirects and supports timeout/cancellation', { timeout: 3000 }, async () => {
  const http = await import('node:http');
  const { bootstrapSession } = await import('../desktop/linux/bootstrap.mjs');
  const token = 'a'.repeat(64); const name = 'banana_' + token.slice(0, 12);
  let mode, requests = 0, installed = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (mode === 'hang') return;
    res.statusCode = mode === 'status' ? 200 : 303;
    res.setHeader('Location', mode === 'redirect' ? '/unexpected' : '/');
    res.setHeader('Set-Cookie', `${name}=${mode === 'wrong-value' ? 'wrong' : token}; ${mode === 'not-http-only' ? '' : 'HttpOnly; '}SameSite=Strict; Path=/`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookies = { async set() { installed++; } };
  try {
    await assert.rejects(bootstrapSession('https://example.invalid', token, cookies), /authentication failed/);
    assert.equal(requests, 0);
    for (mode of ['status', 'redirect', 'wrong-value', 'not-http-only']) {
      const before = requests;
      await assert.rejects(bootstrapSession(origin, token, cookies), /authentication failed/);
      assert.equal(requests, before + 1); assert.equal(installed, 0);
    }
    mode = 'hang';
    await assert.rejects(bootstrapSession(origin, token, cookies, { timeout: 30 }), { name: 'TimeoutError' });
    const controller = new AbortController();
    const pending = assert.rejects(bootstrapSession(origin, token, cookies, { signal: controller.signal }), { name: 'AbortError' });
    controller.abort(); await pending;
    assert.equal(installed, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('vault replaces files privately and never follows a stale predictable temporary symlink', () => {
  const directory = fixture();
  try {
    const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'kwallet6', encryptString: () => Buffer.from('synthetic-ciphertext') };
    const vault = new Vault(directory, storage);
    const target = path.join(directory, 'target'); fs.writeFileSync(target, 'leave intact');
    if (process.platform === 'win32') fs.writeFileSync(vault.file + '.tmp', 'leave intact');
    else fs.symlinkSync(target, vault.file + '.tmp');
    fs.writeFileSync(vault.file, 'old encrypted content', { mode: 0o644 });
    vault.save({});
    assert.equal(fs.readFileSync(target, 'utf8'), 'leave intact');
    if (process.platform !== 'win32') assert.equal(fs.statSync(vault.file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['provider-keys.enc', 'provider-keys.enc.tmp', 'target']);
    storage.encryptString = () => { throw new Error('synthetic failure'); };
    assert.throws(() => vault.save({}));
    assert.equal(fs.readFileSync(vault.file, 'utf8'), 'synthetic-ciphertext');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('sandbox preload exposes only keys and lock, without a generic IPC or credential API', async () => {
  const vm = await import('node:vm');
  const messages = []; let exposed;
  vm.runInNewContext(fs.readFileSync(new URL('../desktop/linux/preload.cjs', import.meta.url), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'bananaLinux'); exposed = value; } },
        ipcRenderer: { send(...args) { messages.push(args); } } };
    },
  });
  assert.deepEqual(Object.keys(exposed), ['postAction']);
  for (const action of ['keys', 'lock', 'unknown', { action: 'keys' }, null]) exposed.postAction(action);
  assert.deepEqual(messages, [['banana:native-action', 'keys'], ['banana:native-action', 'lock']]);
});
test('XDG leaf preparation rejects symlinks without changing their target permissions', { skip: process.platform === 'win32' }, async () => {
  const { prepareDirectories } = await import('../desktop/linux/security.mjs');
  const root = fixture();
  try {
    const target = path.join(root, 'target'), link = path.join(root, 'banana-studio');
    fs.mkdirSync(target, { mode: 0o755 }); fs.symlinkSync(target, link);
    assert.throws(() => prepareDirectories({ config: link }));
    assert.equal(fs.statSync(target).mode & 0o777, 0o755);
    fs.rmSync(link); prepareDirectories({ config: link });
    assert.equal(fs.statSync(link).mode & 0o777, 0o700);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('vault refuses symlinks, oversized files and nonprivate encrypted files', { skip: process.platform === 'win32' }, () => {
  const directory = fixture();
  let decryptions = 0;
  const storage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', decryptString() { decryptions++; return '{}'; } };
  try {
    const v = new Vault(directory, storage), target = path.join(directory, 'target');
    fs.writeFileSync(target, 'synthetic ciphertext', { mode: 0o600 }); fs.symlinkSync(target, v.file);
    assert.throws(() => v.read()); assert.equal(decryptions, 0); fs.rmSync(v.file);
    fs.writeFileSync(v.file, Buffer.alloc(65537), { mode: 0o600 }); assert.throws(() => v.read());
    fs.writeFileSync(v.file, 'synthetic'); fs.chmodSync(v.file, 0o644); assert.throws(() => v.read()); assert.equal(decryptions, 0);
    fs.chmodSync(v.file, 0o600); assert.deepEqual(v.read(), {}); assert.equal(decryptions, 1);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
