import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
if (process.platform !== 'linux' || process.versions.node.split('.')[0] !== '24') {
  throw new Error('The Linux alpha requires Linux and a separate Node.js 24 runtime.');
}
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'desktop/linux/package.json'));
const electron = require('electron');
const desktopEnvironment = Object.fromEntries(['HOME', 'PATH', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'KDE_SESSION_VERSION', 'XDG_SESSION_TYPE', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
const child = spawn(electron, [path.join(root, 'desktop/linux')], {
  shell: false, stdio: 'inherit', env: { ...desktopEnvironment, BANANA_NODE_RUNTIME: process.execPath },
});
child.on('error', () => { process.stderr.write('Electron could not start. Install the Linux alpha dependencies.\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
