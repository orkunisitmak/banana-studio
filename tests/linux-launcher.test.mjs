import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { secureStorage } from '../desktop/linux/security.mjs';

// Execute the actual launcher with a synthetic Linux session and a captured spawn.
// No Electron binary, real keyring or host environment is used by these tests.
const root = path.resolve(import.meta.dirname, '..');
const { code } = transformSync(fs.readFileSync(path.join(root, 'scripts/start-linux.mjs'), 'utf8'), {
  format: 'cjs', define: { 'import.meta.dirname': JSON.stringify(path.join(root, 'scripts')) },
});
function launch(env) {
  let invocation;
  vm.runInNewContext(code, {
    process: { platform: 'linux', versions: { node: '24.0.0' }, execPath: '/synthetic/node', env, on() {} },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:module') return { createRequire: () => dependency => {
        assert.equal(dependency, 'electron'); return '/synthetic/electron';
      } };
      if (name === 'node:child_process') return { spawn(executable, args, options) {
        invocation = JSON.parse(JSON.stringify({ executable, args, options }));
        return { on() {}, kill() {} };
      } };
      throw new Error('Unexpected launcher dependency.');
    },
  });
  return invocation;
}

for (const [desktop, session] of [
  ['KDE Plasma 6', { XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' }],
  ['GNOME', { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }],
]) {
  test(`launcher preserves automatic ${desktop} detection and filters unrelated environment`, () => {
    const common = { DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/synthetic/bus' };
    const invocation = launch({ ...common, ...session,
      OPENAI_API_KEY: 'synthetic-only', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1', UNRELATED: 'omit',
    });
    assert.deepEqual(invocation, {
      executable: '/synthetic/electron', args: [path.join(root, 'desktop/linux')],
      options: { shell: false, stdio: 'inherit', env: { ...common, ...session, BANANA_NODE_RUNTIME: '/synthetic/node' } },
    });
    assert.equal(Object.hasOwn(invocation.options.env, 'KDE_SESSION_VERSION'), desktop === 'KDE Plasma 6');
  });
}

test('KDE and GNOME secure keyrings remain allowed; basic_text is always refused', () => {
  for (const backend of ['kwallet6', 'gnome_libsecret']) {
    assert.doesNotThrow(() => secureStorage({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend }));
    assert.throws(() => secureStorage({ isEncryptionAvailable: () => false, getSelectedStorageBackend: () => backend }), /Secure Linux/);
  }
  assert.throws(() => secureStorage({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'basic_text' }), /basic_text is refused/);
});
