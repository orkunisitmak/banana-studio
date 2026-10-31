import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { auditDistribution } from './audit-distribution.mjs';
import { inspectContent } from './audit-public-release.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifiedBytes(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || sha256(bytes) !== expected) throw new Error('Pinned download checksum mismatch. Nothing was extracted or executed.');
  return bytes;
}
export async function downloadPinned(spec, cache) {
  const url = new URL(spec.url);
  if (url.protocol !== 'https:' || url.username || url.password || !['nodejs.org', 'github.com', 'registry.npmjs.org'].includes(url.hostname)) throw new Error('Unapproved runtime download host.');
  fs.mkdirSync(cache, { recursive: true });
  const target = path.join(cache, spec.sha256);
  if (fs.existsSync(target)) { verifiedBytes(fs.readFileSync(target), spec.sha256); return target; }
  const response = await fetch(url, { redirect: url.hostname === 'github.com' ? 'follow' : 'error', signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error('Pinned runtime download failed.');
  const final = new URL(response.url);
  if (final.protocol !== 'https:' || !['nodejs.org', 'github.com', 'release-assets.githubusercontent.com', 'registry.npmjs.org'].includes(final.hostname)) throw new Error('Unapproved runtime download redirect.');
  let size = 0; const parts = [];
  for await (const part of response.body) { size += part.length; if (size > 250 * 1024 * 1024) throw new Error('Runtime download exceeds size limit.'); parts.push(part); }
  const bytes = verifiedBytes(Buffer.concat(parts), spec.sha256);
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  return target;
}
export function extractVerified(archive, spec, directory, zip = false) {
  verifiedBytes(fs.readFileSync(archive), spec.sha256);
  // Only pinned upstream archives enter a system extractor; no lifecycle scripts run.
  const names = execFileSync(zip ? 'unzip' : 'tar', zip ? ['-Z1', archive] : ['-tf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (names.some(name => !name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..'))) throw new Error('Unsafe archive path.');
  fs.mkdirSync(directory, { recursive: true });
  execFileSync(zip ? 'unzip' : 'tar', zip ? ['-q', archive, '-d', directory] : ['-xf', archive, '-C', directory], { stdio: 'pipe' });
  const inspect = current => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      if (path.isAbsolute(fs.readlinkSync(file)) || !fs.realpathSync(file).startsWith(path.resolve(directory) + path.sep)) throw new Error('External archive symlink.');
    } else if (entry.isDirectory()) inspect(file);
    else if (!entry.isFile()) throw new Error('Unexpected runtime file type.');
  } };
  inspect(directory);
}
export function regularFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('Runtime archives and Linux bundles must not contain links or special files.');
    if (entry.isDirectory()) result.push(...regularFiles(file)); else result.push(file);
  }
  return result;
}
export function normalizeLinuxDirectories(directory) {
  fs.chmodSync(directory, 0o755);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Linux bundles must not contain symlinks.');
    if (entry.isDirectory()) normalizeLinuxDirectories(path.join(directory, entry.name));
  }
}
export function copyLinuxBundle(source, destination) {
  const files = regularFiles(source);
  fs.mkdirSync(destination, { recursive: true, mode: 0o755 });
  for (const file of files) {
    const target = path.join(destination, path.relative(source, file));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
    fs.copyFileSync(file, target);
    // In particular preserve executable modes across host bind mounts.
    fs.chmodSync(target, fs.statSync(file).mode & 0o777);
  }
  normalizeLinuxDirectories(destination);
}
export function elfDetails(bytes) {
  if (bytes.subarray(0, 4).toString('hex') !== '7f454c46') return null;
  if (bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) throw new Error('Wrong architecture: expected Linux x86_64 ELF.');
  const versions = [...bytes.toString('latin1').matchAll(/GLIBC_(\d+)\.(\d+)(?:\.\d+)?\x00/g)].map(match => [Number(match[1]), Number(match[2])]);
  if (versions.some(([major, minor]) => major > 2 || (major === 2 && minor > 39))) throw new Error('Binary requires glibc newer than Ubuntu 24.04.');
  return { glibc: versions.sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]?.join('.') || null };
}
const repository = path.resolve(import.meta.dirname, '..');
const trustedRuntime = () => ({
  node: JSON.parse(fs.readFileSync(path.join(repository, 'desktop/node-runtime.json'))),
  linux: JSON.parse(fs.readFileSync(path.join(repository, 'desktop/linux/runtime-lock.json'))),
});

export function auditLinuxBundle(directory, { privateMarkers = [], trusted = trustedRuntime() } = {}) {
  const report = auditDistribution(directory, { privateMarkers });
  const required = ['banana-studio', 'banana-studio-bin', 'LICENSE', 'LICENSES.chromium.html', 'resources/runtime/bin/node', 'resources/Node-LICENSE.txt', 'resources/LICENSE.txt', 'resources/THIRD_PARTY_NOTICES.md', 'resources/app/package.json', 'resources/app/main.mjs', 'resources/app/resources.mjs', 'resources/runtime-lock.json', 'resources/node-runtime.json', 'resources/LINUX-SOURCES.md', 'SHA256SUMS', 'resources/app/preload.cjs', 'resources/workspace/server.mjs', 'resources/workspace/web/index.html', 'release.json'];
  for (const file of required) if (!fs.existsSync(path.join(directory, file))) report.findings.push({ path: file, rule: 'missing-linux-runtime-file' });
  let elfCount = 0;
  try {
    const checkDirectories = current => {
      if ((fs.statSync(current).mode & 0o7777) !== 0o755) report.findings.push({ path: path.relative(directory, current) || '.', rule: 'unsafe-linux-directory-mode' });
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) if (entry.isDirectory()) checkDirectories(path.join(current, entry.name));
    };
    checkDirectories(directory);
    for (const file of regularFiles(directory)) {
      const relative = path.relative(directory, file).split(path.sep).join('/');
      const bytes = fs.readFileSync(file);
      const stat = fs.statSync(file);
      if ((stat.mode & 0o6022) !== 0) report.findings.push({ path: relative, rule: 'unsafe-linux-file-mode' });
      if (/(^|\/)(?:tests?|scripts|src|install|\.bin)(\/|$)|\.map$|\.d\.(?:ts|mts|cts)$|default_app\.asar$/.test(relative)) report.findings.push({ path: relative, rule: 'linux-development-file' });
      try {
        const elf = elfDetails(bytes); if (elf) elfCount++;
        else if (/\.(?:node|so(?:\.\d+)*)$/.test(relative) || relative === 'banana-studio-bin' || relative === 'resources/runtime/bin/node') report.findings.push({ path: relative, rule: 'invalid-linux-binary' });
      } catch { report.findings.push({ path: relative, rule: 'linux-architecture-or-glibc' }); }
      if (/(?:^|\/)provider-keys\.enc(?:\.|$)/.test(relative)) report.findings.push({ path: relative, rule: 'private-linux-keyring-file' });
      if (/\.(?:mjs|cjs|js|json|html)$/.test(relative)) {
        for (const finding of inspectContent('linux-runtime', bytes)) if (['provider-credential', 'live-project-address', 'machine-path', 'signed-media-link', 'embedded-session-or-api-jwt'].includes(finding.rule)) report.findings.push({ path: relative, rule: 'linux-' + finding.rule });
      }
    }
    const allFiles = regularFiles(directory).map(file => path.relative(directory, file).split(path.sep).join('/'));
    const inventory = new Map();
    for (const line of fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trimEnd().split('\n')) {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match || match[2].startsWith('/') || match[2].split('/').includes('..') || inventory.has(match[2])) throw new Error('Invalid inventory.');
      inventory.set(match[2], match[1]);
    }
    if (inventory.size !== allFiles.length - 1) throw new Error('Incomplete inventory.');
    for (const file of allFiles.filter(file => file !== 'SHA256SUMS')) if (inventory.get(file) !== sha256(fs.readFileSync(path.join(directory, file)))) report.findings.push({ path: file, rule: 'linux-inventory-mismatch' });
    const nodePin = JSON.parse(fs.readFileSync(path.join(directory, 'resources/node-runtime.json')));
    const expectedNode = trusted.node.releases['linux-x64'];
    if (JSON.stringify(nodePin) !== JSON.stringify({ version: trusted.node.version, release: expectedNode })) report.findings.push({ path: 'resources/node-runtime.json', rule: 'untrusted-linux-runtime-pin' });
    if (sha256(fs.readFileSync(path.join(directory, 'resources/runtime/bin/node'))) !== expectedNode.binarySha256 || sha256(fs.readFileSync(path.join(directory, 'resources/Node-LICENSE.txt'))) !== expectedNode.licenseSha256) report.findings.push({ path: 'resources/runtime', rule: 'untrusted-linux-node' });
    for (const [relative, digest] of Object.entries(trusted.linux.binaryAndLicenseSha256)) {
      if (!fs.existsSync(path.join(directory, relative)) || sha256(fs.readFileSync(path.join(directory, relative))) !== digest) report.findings.push({ path: relative, rule: 'untrusted-linux-binary-or-license' });
    }
    if (nodePin.version !== '24.19.0' || sha256(fs.readFileSync(path.join(directory, 'resources/runtime/bin/node'))) !== nodePin.release.binarySha256 || sha256(fs.readFileSync(path.join(directory, 'resources/Node-LICENSE.txt'))) !== nodePin.release.licenseSha256) report.findings.push({ path: 'resources/runtime', rule: 'linux-node-checksum' });
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'release.json')));
    const pins = JSON.parse(fs.readFileSync(path.join(directory, 'resources/runtime-lock.json')));
    if (JSON.stringify({ ...pins, binaryAndLicenseSha256: pins.binaryAndLicenseSha256 ?? trusted.linux.binaryAndLicenseSha256 }) !== JSON.stringify(trusted.linux)) report.findings.push({ path: 'resources/runtime-lock.json', rule: 'untrusted-linux-runtime-pin' });
    const imagePackages = ['sharp', '@img/colour', 'detect-libc', 'semver', '@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64'];
    if (pins.packages.length !== imagePackages.length || imagePackages.some(name => !pins.packages.some(pkg => pkg.name === name))) throw new Error('Unexpected Linux image runtime closure.');
    if (!allFiles.some(file => /^resources\/workspace\/node_modules\/@img\/sharp-linux-x64\/lib\/sharp-linux-x64-[\d.]+\.node$/.test(file)) || !allFiles.some(file => /^resources\/workspace\/node_modules\/@img\/sharp-libvips-linux-x64\/lib\/libvips-cpp\.so\.[\d.]+$/.test(file))) report.findings.push({ path: 'resources/workspace/node_modules/@img', rule: 'linux-image-runtime-missing' });
    if (pins.target !== 'linux-x64' || metadata.platform !== 'linux-x64' || pins.electron.version !== metadata.electronVersion || metadata.nodeVersion !== nodePin.version || JSON.stringify(Object.fromEntries(pins.packages.map(pkg => [pkg.name, pkg.version]))) !== JSON.stringify(metadata.runtimePackages)) throw new Error('Runtime inventory differs from pins.');

    for (const [name, version] of Object.entries(metadata.runtimePackages || {})) {
      const base = path.join(directory, 'resources/workspace/node_modules', name);
      if (JSON.parse(fs.readFileSync(path.join(base, 'package.json'))).version !== version) report.findings.push({ path: name, rule: 'linux-runtime-version' });
      if (!fs.readdirSync(base).some(name => /^licen[cs]e(?:[._-]|$)/i.test(name) && fs.statSync(path.join(base, name)).isFile() && fs.statSync(path.join(base, name)).size > 0)) report.findings.push({ path: name, rule: 'missing-linux-license' });
    }
  } catch { report.findings.push({ path: '.', rule: 'invalid-linux-layout' }); }
  for (const relative of ['banana-studio', 'banana-studio-bin', 'resources/runtime/bin/node']) {
    if (fs.existsSync(path.join(directory, relative)) && !(fs.statSync(path.join(directory, relative)).mode & 0o111)) report.findings.push({ path: relative, rule: 'linux-not-executable' });
  }
  report.elfCount = elfCount; report.ok = report.findings.length === 0;
  return report;
}
export function assertLinuxBundle(directory, options) {
  const report = auditLinuxBundle(directory, options);
  if (!report.ok) throw new Error('Linux distribution audit rejected the bundle: ' + JSON.stringify(report.findings));
  return report;
}
