import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import * as security from '../desktop/linux/security.mjs';
import { providers } from '../desktop/linux/vault.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
// Exercise the actual main-process function with native boundaries replaced.
// The test-only accessor is appended in memory; it is never shipped in Electron.
const source = fs.readFileSync(path.join(root, 'desktop/linux/main.mjs'), 'utf8') + `
module.exports = { showKeys, prepare(value) { workspace = value; origin = 'http://127.0.0.1:12345'; } };`;
const { code } = transformSync(source, {
  format: 'cjs', define: { 'import.meta.dirname': JSON.stringify(path.join(root, 'desktop/linux')) },
});
const secret = 'synthetic-private-content-never-report';
const failure = (code = 'EACCES') => Object.assign(new Error(secret), { code, stdout: secret, stderr: secret });
function harness({ env = {}, execute = callback => callback(null, '\t'.repeat(5) + '\n', ''), refreshError } = {}) {
  const reports = [], logs = [], calls = [], refreshed = [];
  const module = { exports: {} };
  const context = {
    module, AbortController,
    process: { platform: 'linux', env, on() {}, stderr: { write(value) { logs.push(value); } } },
    require(name) {
      if (name === 'electron') return {
        app: { setName() {}, setPath() {}, enableSandbox() {}, on() {}, requestSingleInstanceLock: () => false, quit() {} },
        dialog: { showErrorBox(title, message) { reports.push({ title, message }); } },
      };
      if (name === 'node:fs') return { mkdirSync() {}, chmodSync() {} };
      if (name === 'node:child_process') return { execFile(executable, args, options, callback) {
        calls.push({ executable, args: [...args], options: JSON.parse(JSON.stringify(options)) });
        queueMicrotask(() => execute(callback, calls.at(-1)));
        return { kill() {} };
      } };
      if (name === './security.mjs') return { ...security, prepareDirectories() {}, directories: () => ({ data: '/synthetic/data', config: '/synthetic/config', cache: '/synthetic/cache' }) };
      if (name === './vault.mjs') return { providers };
      if (name === './bootstrap.mjs' || name === './workspace.mjs' || name === './resources.mjs') return {};
      if (name.startsWith('node:')) return require(name);
      throw new Error('Unexpected dependency.');
    },
  };
  vm.runInNewContext(code, context);
  module.exports.prepare({ async send(value) { refreshed.push(value); if (refreshError) throw refreshError; } });
  return { show: module.exports.showKeys, reports, logs, calls, refreshed };
}
const vault = () => ({ saved: [], read() { return {}; }, save(value) { this.saved.push(value); } });

for (const desktop of ['KDE', 'ubuntu:GNOME']) {
  test(`Zenity gets a UTF-8 locale and graphical ${desktop} session without secrets`, async () => {
    const session = { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/synthetic/run', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic/bus', XDG_CURRENT_DESKTOP: desktop };
    const h = harness({ env: { ...session, LANG: 'C', LC_ALL: 'C', OPENAI_API_KEY: secret, NODE_OPTIONS: secret },
      execute(callback, call) {
        assert.equal(call.options.env.LANG, 'C.UTF-8');
        assert.equal(call.options.env.LC_ALL, 'C.UTF-8');
        assert.ok(call.args.some(arg => arg.includes('—'))); // Original GLib failure trigger.
        assert.equal(call.args.filter(arg => arg.startsWith('--add-password=')).length, 6);
        callback(null, '\t'.repeat(5) + '\n', '');
      },
    });
    const v = vault(); await h.show(v);
    assert.equal(h.calls[0].executable, '/usr/bin/zenity');
    assert.equal(h.calls[0].options.shell, false);
    assert.deepEqual(h.calls[0].options.env, { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...session });
    assert.equal(v.saved.length, 1); assert.equal(h.refreshed.length, 1);
    assert.deepEqual(h.logs, []); assert.deepEqual(h.reports, []);
  });
}

test('pre-form GLib conversion failure identifies Zenity, exit and locale without exposing output', async () => {
  const h = harness({ execute: callback => callback(failure(255), secret, `Invalid byte sequence in conversion input\n${secret}`) });
  const v = vault(); await h.show(v);
  assert.equal(v.saved.length, 0); assert.equal(h.refreshed.length, 0);
  assert.match(h.reports[0].message, /phase=zenity exit=255 reason=locale-conversion/);
  assert.match(h.logs[0], /phase=zenity exit=255 reason=locale-conversion/);
  assert.ok(!JSON.stringify([h.reports, h.logs]).includes(secret));
});

test('each key flow failure reports its actual phase without raw errors or form content', async () => {
  for (const phase of ['vault-read', 'zenity', 'form-parse', 'vault-save', 'workspace-refresh']) {
    const h = harness({
      execute: callback => phase === 'zenity' ? callback(failure('ENOENT'), secret, secret) : callback(null, phase === 'form-parse' ? secret : secret + '\t'.repeat(5) + '\n', ''),
      refreshError: phase === 'workspace-refresh' ? failure() : undefined,
    });
    const v = vault();
    if (phase === 'vault-read') v.read = () => { throw failure(); };
    if (phase === 'vault-save') v.save = () => { throw failure(); };
    await h.show(v);
    assert.equal(h.reports.length, 1); assert.equal(h.logs.length, 1);
    assert.ok(h.reports[0].message.includes(`phase=${phase}`));
    assert.ok(h.logs[0].includes(`phase=${phase}`));
    assert.ok(!JSON.stringify([h.reports, h.logs]).includes(secret));
    assert.equal(h.refreshed.length, phase === 'workspace-refresh' ? 1 : 0);
    if (phase === 'vault-read') assert.equal(h.calls.length, 0);
  }
});

test('native cancel is quiet; a recognized display failure with exit 1 is reported', async () => {
  const cancelled = harness({ execute: callback => callback(failure(1), secret, '') });
  const v = vault(); await cancelled.show(v);
  assert.deepEqual(cancelled.logs, []); assert.deepEqual(cancelled.reports, []);
  assert.equal(v.saved.length, 0); assert.equal(cancelled.refreshed.length, 0);
  const unavailable = harness({ execute: callback => callback(failure(1), secret, `Gtk-WARNING: cannot open display\n${secret}`) });
  await unavailable.show(vault());
  assert.match(unavailable.reports[0].message, /phase=zenity exit=1 reason=display-unavailable/);
  assert.ok(!JSON.stringify([unavailable.reports, unavailable.logs]).includes(secret));
});

test('unrecognized error codes and signals cannot carry private content into diagnostics', async () => {
  const error = Object.assign(failure(secret), { signal: secret });
  const h = harness({ execute: callback => callback(error, secret, secret) });
  await h.show(vault());
  assert.deepEqual(h.logs, ['[Banana Studio] Provider Keys: phase=zenity\n']);
  assert.ok(!JSON.stringify([h.reports, h.logs]).includes(secret));
});
