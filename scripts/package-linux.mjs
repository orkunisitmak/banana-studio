import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { downloadPinned, extractVerified, sha256, verifiedBytes, regularFiles, assertLinuxBundle, normalizeLinuxDirectories } from './linux-packaging.mjs';
import { linuxNotices } from './linux-notices.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pins = JSON.parse(fs.readFileSync(path.join(root, 'desktop/linux/runtime-lock.json')));
const nodeLock = JSON.parse(fs.readFileSync(path.join(root, 'desktop/node-runtime.json')));
const npmLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages;
const electronPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop/linux/package.json')));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
if (!/^\d+\.\d+\.\d+$/.test(version) || pins.target !== 'linux-x64' || nodeLock.version !== '24.19.0' || electronPackage.devDependencies.electron !== pins.electron.version) throw new Error('Linux runtime pins need review.');
for (const pkg of pins.packages) if (npmLock[pkg.lockPath]?.version !== pkg.version || npmLock[pkg.lockPath]?.resolved !== pkg.url) throw new Error('Linux image dependency pins differ from package-lock.json.');
for (const file of ['dist/index.html', '.build/desktop/server.mjs', '.build/web-modules.json', '.build/desktop/metafile.json']) if (!fs.existsSync(path.join(root, file))) throw new Error('Run the frontend and desktop builds before packaging.');
const cache = path.join(root, '.build/linux-downloads');
const staging = fs.mkdtempSync(path.join(root, '.build/linux-stage-'));
const app = path.join(staging, 'BananaStudio');
try {
  const electronArchive = await downloadPinned(pins.electron, cache);
  extractVerified(electronArchive, pins.electron, app, true);
  fs.renameSync(path.join(app, 'electron'), path.join(app, 'banana-studio-bin'));
  fs.rmSync(path.join(app, 'resources/default_app.asar'), { force: true });
  const resources = path.join(app, 'resources'), workspace = path.join(resources, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const nodeSpec = { url: nodeLock.releases['linux-x64'].url, sha256: nodeLock.releases['linux-x64'].archiveSha256 };
  const nodeArchive = await downloadPinned(nodeSpec, cache);
  const nodeExtract = path.join(staging, 'node'); extractVerified(nodeArchive, nodeSpec, nodeExtract);
  const official = path.join(nodeExtract, `node-v${nodeLock.version}-linux-x64`);
  verifiedBytes(fs.readFileSync(path.join(official, 'bin/node')), nodeLock.releases['linux-x64'].binarySha256);
  verifiedBytes(fs.readFileSync(path.join(official, 'LICENSE')), nodeLock.releases['linux-x64'].licenseSha256);
  fs.mkdirSync(path.join(resources, 'runtime/bin'), { recursive: true });
  fs.copyFileSync(path.join(official, 'bin/node'), path.join(resources, 'runtime/bin/node'));
  fs.copyFileSync(path.join(official, 'LICENSE'), path.join(resources, 'Node-LICENSE.txt'));
  fs.copyFileSync(path.join(root, '.build/desktop/server.mjs'), path.join(workspace, 'server.mjs'));
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'banana-studio-workspace', private: true, type: 'module' }));
  fs.cpSync(path.join(root, 'dist'), path.join(workspace, 'web'), { recursive: true });
  const shell = path.join(resources, 'app'); fs.mkdirSync(shell);
  for (const file of ['main.mjs', 'security.mjs', 'workspace.mjs', 'resources.mjs', 'bootstrap.mjs', 'vault.mjs', 'preload.cjs']) fs.copyFileSync(path.join(root, 'desktop/linux', file), path.join(shell, file));
  fs.writeFileSync(path.join(shell, 'package.json'), JSON.stringify({ name: 'banana-studio-linux-alpha', productName: 'Banana Studio Linux Alpha', version, private: true, type: 'module', main: 'main.mjs' }));

  const runtimePackages = Object.fromEntries(pins.packages.map(pkg => [pkg.name, pkg.version]));
  for (const spec of pins.packages) {
    const archive = await downloadPinned(spec, cache);
    // Verify the main lockfile's SRI as well as the Linux SHA-256 pin.
    const [algorithm, expected] = npmLock[spec.lockPath].integrity.split('-');
    if (createHash(algorithm).update(fs.readFileSync(archive)).digest('base64') !== expected) throw new Error('Linux npm archive integrity mismatch.');
    const extracted = path.join(staging, 'packages', spec.name.replaceAll('/', '-'));
    extractVerified(archive, spec, extracted);
    const source = path.join(extracted, 'package');
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
    if (pkg.name !== spec.name || pkg.version !== spec.version) throw new Error('Unexpected Linux runtime package.');
    for (const name of Object.keys(pkg.dependencies || {})) if (!runtimePackages[name]) throw new Error('Incomplete sharp runtime dependency closure.');
    const destination = path.join(workspace, 'node_modules', spec.name); fs.mkdirSync(destination, { recursive: true });
    for (const file of regularFiles(source)) {
      const relative = path.relative(source, file);
      if (relative.split(path.sep).some(part => ['src', 'install', 'bin'].includes(part)) || /\.d\.(?:ts|cts|mts)$/.test(file)) continue;
      if (!/\.(?:js|cjs|mjs|json|node)$|\.so(?:\.\d+)*$|^(?:licen[cs]e|readme|notice)/i.test(path.basename(file))) continue;
      const target = path.join(destination, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target);
    }
  }
  const licenseRoot = path.join(root, 'docs/third-party-licenses/linux-libvips-1.3.4');
  const licenses = JSON.parse(fs.readFileSync(path.join(licenseRoot, 'provenance.json')));
  const libvipsLicense = ['# libvips and bundled dependencies\n\nExact component versions are in versions.json. Upstream source/build recipe and license provenance accompany this file. LGPL libraries are dynamically linked; replacement of libvips is permitted. See resources/LINUX-SOURCES.md.\n'];
  for (const license of licenses) {
    const bytes = verifiedBytes(fs.readFileSync(path.join(licenseRoot, license.name + '.txt')), license.sha256);
    libvipsLicense.push(`## ${license.name}\nSource: ${license.url}\n\n${bytes.toString('utf8')}`);
  }
  fs.writeFileSync(path.join(workspace, 'node_modules/@img/sharp-libvips-linux-x64/LICENSE.txt'), libvipsLicense.join('\n\n'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(resources, 'LICENSE.txt'));
  fs.writeFileSync(path.join(resources, 'THIRD_PARTY_NOTICES.md'), linuxNotices(root, path.join(workspace, 'node_modules')));
  fs.copyFileSync(path.join(root, 'desktop/linux/LINUX-SOURCES.md'), path.join(resources, 'LINUX-SOURCES.md'));
  fs.copyFileSync(path.join(root, 'desktop/linux/runtime-lock.json'), path.join(resources, 'runtime-lock.json'));
  fs.writeFileSync(path.join(resources, 'node-runtime.json'), JSON.stringify({ version: nodeLock.version, release: nodeLock.releases['linux-x64'] }, null, 2));
  fs.copyFileSync(path.join(root, 'public/icon-512.png'), path.join(resources, 'banana-studio.png'));
  fs.cpSync(path.join(root, 'desktop/linux/integration'), path.join(app, 'integration'), { recursive: true });
  fs.copyFileSync(path.join(root, 'desktop/linux/launcher.sh'), path.join(app, 'banana-studio'));
  for (const file of regularFiles(app)) fs.chmodSync(file, 0o644);
  for (const file of ['banana-studio', 'banana-studio-bin', 'chrome-sandbox', 'chrome_crashpad_handler', 'resources/runtime/bin/node']) fs.chmodSync(path.join(app, file), 0o755);
  let sourceCommit = null, sourceDirty = true;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
  } catch { /* A source snapshot is identified honestly, without claiming a clean revision. */ }
  fs.writeFileSync(path.join(app, 'release.json'), JSON.stringify({ version, debVersion: version + '~linuxalpha1', platform: 'linux-x64', distribution: 'unsigned-development-alpha', sourceCommit, sourceDirty, electronVersion: pins.electron.version, nodeVersion: nodeLock.version, runtimePackages }, null, 2));
  fs.chmodSync(path.join(app, 'release.json'), 0o644);
  // Inventory includes generated shell, frontend/server, binaries and notices.
  fs.writeFileSync(path.join(app, 'SHA256SUMS'), regularFiles(app).sort().map(file => sha256(fs.readFileSync(file)) + '  ' + path.relative(app, file).split(path.sep).join('/')).join('\n') + '\n');
  fs.chmodSync(path.join(app, 'SHA256SUMS'), 0o644);
  normalizeLinuxDirectories(app);
  const report = assertLinuxBundle(app, { privateMarkers: [root] });
  const target = path.join(root, '.build/linux-x64/BananaStudio'); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(app, target);
  const artifacts = path.join(root, '.build/linux-artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  const archive = path.join(artifacts, `banana-studio-${version}-linux-x64-alpha.tar.gz`);
  const owners = process.platform === 'darwin' ? ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root'] : ['--owner=0', '--group=0', '--numeric-owner'];
  execFileSync('tar', [...owners, '-czf', archive, '-C', path.dirname(target), 'BananaStudio'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe' });
  fs.writeFileSync(archive + '.sha256', sha256(fs.readFileSync(archive)) + '  ' + path.basename(archive) + '\n');
  console.log(JSON.stringify({ bundle: target, archive, files: report.files, elfCount: report.elfCount, executionVerified: false }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
