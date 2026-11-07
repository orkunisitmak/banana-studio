import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { assertLinuxBundle, sha256, regularFiles, normalizeLinuxDirectories } from './linux-packaging.mjs';

// Never install into the host root or run AppArmor operations against its kernel.
if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() !== 0 || !fs.existsSync('/.dockerenv')) throw new Error('Run this lifecycle fixture in a disposable Ubuntu amd64 Docker container as root.');
const input = process.argv.slice(2).find(arg => !arg.startsWith('--'));
if (!input) throw new Error('Pass the alpha .deb path; optionally --install-dependencies inside the disposable container.');
const deb = fs.realpathSync(input);
const run = (tool, args, options = {}) => execFileSync(tool, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
const name = run('dpkg-deb', ['--field', deb, 'Package'], { encoding: 'utf8' }).trim();
assert.equal(name, 'banana-studio-linux-alpha');
if (process.argv.includes('--install-dependencies')) {
  const names = run('dpkg-deb', ['--field', deb, 'Depends'], { encoding: 'utf8' }).split(',').map(item => item.trim().split(/\s/)[0]);
  if (names.some(name => !/^[a-z0-9][a-z0-9+.-]*$/.test(name))) throw new Error('Unsupported dependency declaration.');
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  run('apt-get', ['update', '-qq'], { env }); run('apt-get', ['install', '-y', '-qq', '--no-install-recommends', ...names], { env });
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-deb-lifecycle-'));
const jail = path.join(temporary, 'root'), extracted = path.join(temporary, 'extracted');
try {
  run('dpkg-deb', ['--raw-extract', deb, extracted]); assertLinuxBundle(path.join(extracted, 'opt/banana-studio'));
  const put = (relative, bytes, mode = 0o644) => { const file = path.join(jail, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); fs.chmodSync(file, mode); return file; };
  // A private dpkg database mirrors the container's genuinely installed dependencies.
  // Only sh and its loader/libc are needed in the jail to execute maintainer scripts.
  put('var/lib/dpkg/status', fs.readFileSync('/var/lib/dpkg/status'));
  for (const directory of ['info', 'updates', 'triggers']) fs.mkdirSync(path.join(jail, 'var/lib/dpkg', directory));
  const shell = fs.realpathSync('/bin/sh'); put('bin/sh', fs.readFileSync(shell), 0o755);
  const libraries = run('ldd', [shell], { encoding: 'utf8' }).match(/\/[A-Za-z0-9_./+-]+/g) || [];
  for (const file of new Set(libraries)) put(file, fs.readFileSync(file), 0o755);
  assert.equal(fs.existsSync(path.join(jail, 'sys')), false);
  const home = 'home/banana-fixture';
  put(`${home}/.config/banana-studio/provider-keys.enc`, 'synthetic-ciphertext-not-a-real-key', 0o600);
  const database = put(`${home}/.local/share/banana-studio/workspace.sqlite`, '', 0o600);
  const db = new DatabaseSync(database); db.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('synthetic fixture')"); db.close();
  put(`${home}/.local/share/banana-studio/media/refs/synthetic.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+1sAAAAASUVORK5CYII=', 'base64'), 0o600);
  const userHome = path.join(jail, home);
  const ownFixture = current => {
    fs.chownSync(current, 1000, 1000);
    if (fs.statSync(current).isDirectory()) { fs.chmodSync(current, 0o700); for (const name of fs.readdirSync(current)) ownFixture(path.join(current, name)); }
  };
  ownFixture(userHome);
  const snapshot = () => {
    const result = [];
    const visit = current => {
      const stat = fs.lstatSync(current);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unexpected user-data file type.');
      result.push([path.relative(jail, current), stat.mode & 0o777, stat.uid, stat.gid, stat.isFile() ? sha256(fs.readFileSync(current)) : 'directory']);
      if (stat.isDirectory()) for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
    }; visit(userHome); return result;
  };
  const initial = snapshot();
  const dpkg = (...args) => run('dpkg', [`--root=${jail}`, ...args]);
  const checkInstalled = () => {
    for (const file of ['usr/bin/banana-studio', 'opt/banana-studio/banana-studio', 'opt/banana-studio/resources/runtime/bin/node']) assert.equal(fs.statSync(path.join(jail, file)).mode & 0o777, 0o755);
    assertLinuxBundle(path.join(jail, 'opt/banana-studio')); assert.deepEqual(snapshot(), initial);
  };
  dpkg('--install', deb); checkInstalled();
  // Control-only next-version fixture, not a claimed new application build.
  const nextVersion = run('dpkg-deb', ['--field', deb, 'Version'], { encoding: 'utf8' }).trim().replace(/\d+$/, value => String(Number(value) + 1));
  const controlFile = path.join(extracted, 'DEBIAN/control');
  fs.writeFileSync(controlFile, fs.readFileSync(controlFile, 'utf8').replace(/^Version: .*$/m, 'Version: ' + nextVersion));
  const next = path.join(temporary, 'next-version.deb'); normalizeLinuxDirectories(extracted);
  run('dpkg-deb', ['--root-owner-group', '-Zxz', '-z1', '--build', extracted, next]);
  dpkg('--install', next); checkInstalled();
  const query = run('dpkg-query', [`--admindir=${path.join(jail, 'var/lib/dpkg')}`, '--show', '--showformat=${Version}', name], { encoding: 'utf8' });
  assert.equal(query, nextVersion);
  dpkg('--remove', name); assert.deepEqual(snapshot(), initial); assert.equal(fs.existsSync(path.join(jail, 'usr/bin/banana-studio')), false);
  assert.equal(fs.existsSync(path.join(jail, 'etc/apparmor.d/banana-studio')), true); // dpkg keeps conffiles on remove.
  dpkg('--install', next); checkInstalled();
  dpkg('--purge', name); assert.deepEqual(snapshot(), initial);
  assert.equal(fs.existsSync(path.join(jail, 'etc/apparmor.d/banana-studio')), false);
  console.log('dpkg isolated-root install, version upgrade, remove, reinstall and purge: 5/5 passed; synthetic SQLite/media/encrypted-file bytes, permissions and UID/GID preserved. No GUI or kernel profile loading was tested.');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
