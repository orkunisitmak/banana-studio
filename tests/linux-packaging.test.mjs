import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sha256, verifiedBytes, elfDetails, auditLinuxBundle, extractVerified, copyLinuxBundle, normalizeLinuxDirectories } from '../scripts/linux-packaging.mjs';
import { linuxNotices } from '../scripts/linux-notices.mjs';
import { workspaceResources } from '../desktop/linux/resources.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pins = JSON.parse(fs.readFileSync(path.join(root, 'desktop/linux/runtime-lock.json')));
const nodePin = JSON.parse(fs.readFileSync(path.join(root, 'desktop/node-runtime.json')));
const elf = (machine = 62, version = '2.28') => {
  const bytes = Buffer.alloc(128); bytes.write('\x7fELF'); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(machine, 18); bytes.write('GLIBC_' + version + '\0', 64); return bytes;
};
test('packaged resources always use bundled Node/workspace independently of cwd and environment overrides', () => {
  assert.deepEqual(workspaceResources({ packaged: true, resourcesPath: '/opt/banana-studio/resources', developmentRoot: '/unavailable', runtime: '/untrusted/node' }), {
    runtime: path.join('/opt/banana-studio/resources', 'runtime/bin/node'), server: path.join('/opt/banana-studio/resources', 'workspace/server.mjs'), web: path.join('/opt/banana-studio/resources', 'workspace/web'), cwd: path.join('/opt/banana-studio/resources', 'workspace'),
  });
  const development = workspaceResources({ packaged: false, developmentRoot: '/checkout', runtime: '/selected/node24' });
  assert.equal(development.runtime, '/selected/node24'); assert.equal(development.server, path.join('/checkout', '.build/desktop/server.mjs')); assert.equal(development.web, path.join('/checkout', 'dist'));
});
test('Linux pins match the exact root/Electron lockfiles, with separate verified Node 24.19.0', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages;
  const electronLock = JSON.parse(fs.readFileSync(path.join(root, 'desktop/linux/package-lock.json'))).packages;
  assert.equal(pins.electron.version, electronLock['node_modules/electron'].version);
  for (const pkg of pins.packages) { assert.equal(pkg.version, lock[pkg.lockPath].version); assert.equal(pkg.url, lock[pkg.lockPath].resolved); assert.match(pkg.sha256, /^[a-f0-9]{64}$/); }
  assert.equal(nodePin.version, '24.19.0'); assert.match(nodePin.releases['linux-x64'].url, /^https:\/\/nodejs.org\/dist\/v24\.19\.0\/node-v24\.19\.0-linux-x64\.tar\.gz$/);
  for (const key of ['archiveSha256', 'binarySha256', 'licenseSha256']) assert.match(nodePin.releases['linux-x64'][key], /^[a-f0-9]{64}$/);
});
test('checksums fail before extraction; ELF architecture and Ubuntu glibc ceilings are enforced', () => {
  const bytes = Buffer.from('synthetic-download'); assert.equal(verifiedBytes(bytes, sha256(bytes)), bytes);
  assert.throws(() => verifiedBytes(bytes, '0'.repeat(64)), /checksum mismatch/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-download-test-'));
  try { const archive = path.join(directory, 'archive'); const output = path.join(directory, 'extracted'); fs.writeFileSync(archive, bytes); assert.throws(() => extractVerified(archive, { sha256: '0'.repeat(64) }, output), /checksum mismatch/); assert.equal(fs.existsSync(output), false); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
  assert.deepEqual(elfDetails(elf()), { glibc: '2.28' }); assert.throws(() => elfDetails(elf(183)), /architecture/); assert.throws(() => elfDetails(elf(62, '2.40')), /glibc/);
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-linux-artifact-'));
  const put = (file, value, mode = 0o644) => { const target = path.join(directory, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value, { mode }); };
  for (const file of ['LICENSE', 'LICENSES.chromium.html', 'resources/Node-LICENSE.txt', 'resources/LICENSE.txt', 'resources/THIRD_PARTY_NOTICES.md', 'resources/app/main.mjs', 'resources/app/resources.mjs', 'resources/app/preload.cjs', 'resources/workspace/server.mjs', 'resources/workspace/web/index.html', 'resources/LINUX-SOURCES.md']) put(file, 'synthetic fixture');
  put('banana-studio', '#!/bin/sh\nexit 0\n', 0o755); put('banana-studio-bin', elf(), 0o755); put('resources/runtime/bin/node', elf(), 0o755); put('resources/app/package.json', '{}');
  put('resources/node-runtime.json', JSON.stringify({ version: '24.19.0', release: { binarySha256: sha256(elf()), licenseSha256: sha256(Buffer.from('synthetic fixture')) } }));
  put('resources/runtime-lock.json', JSON.stringify(pins));
  put('release.json', JSON.stringify({ platform: 'linux-x64', electronVersion: pins.electron.version, nodeVersion: '24.19.0', runtimePackages: Object.fromEntries(pins.packages.map(pkg => [pkg.name, pkg.version])) }));
  for (const pkg of pins.packages) { put(`resources/workspace/node_modules/${pkg.name}/package.json`, JSON.stringify({ name: pkg.name, version: pkg.version })); put(`resources/workspace/node_modules/${pkg.name}/LICENSE`, 'synthetic license'); }
  put('resources/workspace/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64-0.35.5.node', elf());
  put('resources/workspace/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.7', elf());
  const inventory = () => {
    const files = []; const visit = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const file = path.join(current, entry.name); if (entry.isDirectory()) visit(file); else if (entry.isFile() && file !== path.join(directory, 'SHA256SUMS')) files.push(file); } }; visit(directory);
    put('SHA256SUMS', files.map(file => `${sha256(fs.readFileSync(file))}  ${path.relative(directory, file).split(path.sep).join('/')}`).join('\n') + '\n');
  };
  const trusted = { linux: { ...pins, binaryAndLicenseSha256: { 'banana-studio-bin': sha256(elf()) } }, node: { version: '24.19.0', releases: { 'linux-x64': { binarySha256: sha256(elf()), licenseSha256: sha256(Buffer.from('synthetic fixture')) } } } };
  put('resources/runtime-lock.json', JSON.stringify(trusted.linux));
  inventory(); normalizeLinuxDirectories(directory); return { trusted, directory, put, inventory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
test('artifact audit checks every dependency, inventory, licenses, secrets, file modes and ELF headers', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    assert.equal(auditLinuxBundle(f.directory, { trusted: f.trusted }).ok, true);
    f.put('resources/workspace/node_modules/sharp/lib/bad.node', elf(183));
    f.put('resources/workspace/node_modules/sharp/tests/fixture.js', 'synthetic');
    f.put('resources/workspace/node_modules/sharp/.env', '');
    f.put('resources/workspace/node_modules/sharp/private.js', ['sk', 'proj', 'A'.repeat(40)].join('-'));
    fs.rmSync(path.join(f.directory, 'resources/workspace/node_modules/sharp/LICENSE'));
    f.put('resources/provider-keys.enc', 'synthetic ciphertext');
    f.put('resources/workspace/web/account.json', JSON.stringify({ url: 'https://' + 'a'.repeat(20) + '.supabase.co' }));
    f.inventory(); const report = auditLinuxBundle(f.directory, { trusted: f.trusted });
    for (const rule of ['linux-architecture-or-glibc', 'linux-development-file', 'private-artifact-file', 'artifact-credential', 'missing-linux-license', 'private-linux-keyring-file', 'linux-live-project-address']) assert.ok(report.findings.some(f => f.rule === rule), rule);
    f.put('resources/app/main.mjs', 'tampered'); assert.ok(auditLinuxBundle(f.directory, { trusted: f.trusted }).findings.some(f => f.rule === 'linux-inventory-mismatch'));
    if (process.platform !== 'win32') { fs.chmodSync(path.join(f.directory, 'banana-studio'), 0o777); assert.ok(auditLinuxBundle(f.directory, { trusted: f.trusted }).findings.some(f => f.rule === 'unsafe-linux-file-mode')); }
    fs.symlinkSync(os.tmpdir(), path.join(f.directory, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.ok(auditLinuxBundle(f.directory, { trusted: f.trusted }).findings.some(f => f.rule === 'external-artifact-symlink'));
  } finally { f.cleanup(); }
});
test('libvips component license texts and source recipe match reviewed provenance', () => {
  const directory = path.join(root, 'docs/third-party-licenses/linux-libvips-1.3.4');
  const entries = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json')));
  for (const entry of entries) assert.equal(sha256(fs.readFileSync(path.join(directory, entry.name + '.txt'))), entry.sha256);
  for (const name of ['GPL3', 'LGPL3', 'vips', 'glib', 'build-recipe']) assert.ok(entries.some(entry => entry.name === name));
});
test('portable launcher forwards KDE/GNOME session inputs while discarding flags and credential overrides', { skip: process.platform === 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-launcher-test-'));
  try {
    fs.copyFileSync(path.join(root, 'desktop/linux/launcher.sh'), path.join(directory, 'banana-studio')); fs.chmodSync(path.join(directory, 'banana-studio'), 0o755);
    fs.writeFileSync(path.join(directory, 'banana-studio-bin'), '#!/bin/sh\nprintf "%s\\n" "$XDG_CURRENT_DESKTOP" "${KDE_SESSION_VERSION-absent}" "${NODE_OPTIONS-absent}" "${OPENAI_API_KEY-absent}" "$#" "${1-absent}"\n', { mode: 0o755 });
    for (const env of [{ XDG_CURRENT_DESKTOP: 'KDE', KDE_SESSION_VERSION: '6' }, { XDG_CURRENT_DESKTOP: 'GNOME' }]) {
      const output = execFileSync(path.join(directory, 'banana-studio'), ['--no-sandbox'], { cwd: os.tmpdir(), env: { ...env, NODE_OPTIONS: 'synthetic', OPENAI_API_KEY: 'synthetic' }, encoding: 'utf8' });
      assert.equal(output, `${env.XDG_CURRENT_DESKTOP}\n${env.KDE_SESSION_VERSION || 'absent'}\nabsent\nabsent\n1\n--class=banana-studio-linux-alpha\n`);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bundle staging preserves executable modes rather than trusting copyFile defaults', { skip: process.platform === 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-mode-test-'));
  try {
    const source = path.join(directory, 'source'), target = path.join(directory, 'target'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'binary'), 'synthetic', { mode: 0o755 }); fs.writeFileSync(path.join(source, 'license'), 'synthetic', { mode: 0o644 });
    const previous = process.umask(0o077);
    try { copyLinuxBundle(source, target); } finally { process.umask(previous); }
    assert.equal(fs.statSync(path.join(target, 'binary')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(path.join(target, 'license')).mode & 0o777, 0o644);
    assert.equal(fs.statSync(target).mode & 0o777, 0o755);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('foreign checkout metadata cannot silently omit bundled JS license notices', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-license-inventory-'));
  try {
    fs.mkdirSync(path.join(directory, '.build/desktop'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.build/web-modules.json'), '[]');
    fs.writeFileSync(path.join(directory, '.build/desktop/metafile.json'), JSON.stringify({ outputs: { server: { inputs: { 'node_modules/missing/index.js': { bytesInOutput: 1 } } } } }));
    assert.throws(() => linuxNotices(directory, directory), /another checkout/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('rewriting bundled pins and inventory cannot bless substituted runtime binaries', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const replacement = Buffer.concat([elf(), Buffer.from('substituted')]);
    f.put('resources/runtime/bin/node', replacement, 0o755);
    const forged = { version: '24.19.0', release: { ...f.trusted.node.releases['linux-x64'], binarySha256: sha256(replacement) } };
    f.put('resources/node-runtime.json', JSON.stringify(forged));
    f.put('banana-studio-bin', replacement, 0o755);
    const forgedLinux = structuredClone(f.trusted.linux); forgedLinux.binaryAndLicenseSha256['banana-studio-bin'] = sha256(replacement);
    f.put('resources/runtime-lock.json', JSON.stringify(forgedLinux)); f.inventory();
    const result = auditLinuxBundle(f.directory, { trusted: f.trusted });
    for (const rule of ['untrusted-linux-runtime-pin', 'untrusted-linux-node', 'untrusted-linux-binary-or-license']) assert.ok(result.findings.some(f => f.rule === rule));
  } finally { f.cleanup(); }
});
