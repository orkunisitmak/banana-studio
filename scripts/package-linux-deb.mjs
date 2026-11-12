import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assertLinuxBundle, sha256, copyLinuxBundle, normalizeLinuxDirectories } from './linux-packaging.mjs';
import { auditDistribution } from './audit-distribution.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build the Ubuntu .deb on Linux x86_64 with dpkg-deb. No package was produced.');
const root = path.resolve(import.meta.dirname, '..');
const bundle = path.resolve(process.argv[2] || path.join(root, '.build/linux-x64/BananaStudio'));
assertLinuxBundle(bundle);
execFileSync('dpkg-deb', ['--version'], { stdio: 'pipe' });
const metadata = JSON.parse(fs.readFileSync(path.join(bundle, 'release.json')));
if (!/^\d+\.\d+\.\d+~linuxalpha\d+$/.test(metadata.debVersion)) throw new Error('Invalid Linux alpha package version.');
const stage = fs.mkdtempSync(path.join(root, '.build/linux-deb-'));
let output, complete = false;
try {
  const installed = path.join(stage, 'opt/banana-studio'); fs.mkdirSync(path.dirname(installed));
  copyLinuxBundle(bundle, installed);
  const control = path.join(stage, 'DEBIAN'); fs.mkdirSync(control);
  const dependencies = 'libc6 (>= 2.39), libgcc-s1, libstdc++6, libglib2.0-0t64, libgtk-3-0t64, libnss3, libnspr4, libatk1.0-0t64, libatk-bridge2.0-0t64, libatspi2.0-0t64, libcups2t64, libdrm2, libdbus-1-3, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxrandr2, libgbm1, libxkbcommon0, libasound2t64, libsecret-1-0, zenity, apparmor (>= 4.0)';
  fs.writeFileSync(path.join(control, 'control'), `Package: banana-studio-linux-alpha\nVersion: ${metadata.debVersion}\nArchitecture: amd64\nMaintainer: Banana Studio contributors <noreply@github.com>\nSection: graphics\nPriority: optional\nDepends: ${dependencies}\nRecommends: gnome-keyring | kwallet6 | libkf5wallet-bin\nHomepage: https://github.com/orkunisitmak/banana-studio\nDescription: Banana Studio self-contained Linux development alpha\n Unsigned community alpha with a local SQLite workspace and secure keyring.\n Bundled Node.js and Electron; no system Node, npm or source checkout needed.\n`);
  fs.chmodSync(path.join(control, 'control'), 0o644);
  const put = (relative, bytes, mode = 0o644) => { const file = path.join(stage, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { mode }); fs.chmodSync(file, mode); };
  put('usr/bin/banana-studio', '#!/bin/sh\nexec /opt/banana-studio/banana-studio\n', 0o755);
  put('usr/share/applications/banana-studio.desktop', fs.readFileSync(path.join(installed, 'integration/banana-studio.desktop')));
  put('usr/share/icons/hicolor/512x512/apps/banana-studio.png', fs.readFileSync(path.join(installed, 'resources/banana-studio.png')));
  put('etc/apparmor.d/banana-studio', fs.readFileSync(path.join(installed, 'integration/banana-studio.apparmor')));
  put('usr/share/doc/banana-studio-linux-alpha/copyright', fs.readFileSync(path.join(installed, 'resources/LICENSE.txt')));
  fs.writeFileSync(path.join(control, 'conffiles'), '/etc/apparmor.d/banana-studio\n');
  fs.chmodSync(path.join(control, 'conffiles'), 0o644);
  // Only install/remove this application's profile. No sysctl, root-owned SUID
  // helper, global sandbox override or user data changes are made by the package.
  const profileAction = action => `if [ -r /sys/module/apparmor/parameters/enabled ] && grep -q Y /sys/module/apparmor/parameters/enabled && [ -f /etc/apparmor.d/banana-studio ]; then\n  apparmor_parser ${action} /etc/apparmor.d/banana-studio\nfi\n`;
  put('DEBIAN/postinst', '#!/bin/sh\nset -e\nif [ "$1" = configure ]; then\n' + profileAction('-r') + 'fi\n', 0o755);
  put('DEBIAN/prerm', '#!/bin/sh\nset -e\nif [ "$1" = remove ] || [ "$1" = deconfigure ]; then\n  if [ -r /sys/kernel/security/apparmor/profiles ] && [ -f /etc/apparmor.d/banana-studio ] && grep -Fq "/opt/banana-studio/banana-studio-bin " /sys/kernel/security/apparmor/profiles; then\n    apparmor_parser -R /etc/apparmor.d/banana-studio\n  fi\nfi\n', 0o755);
  normalizeLinuxDirectories(stage);
  const report = auditDistribution(stage);
  if (!report.ok) throw new Error('Debian staging audit rejected the package: ' + JSON.stringify(report.findings));
  const artifacts = path.join(root, '.build/linux-artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  output = path.join(artifacts, `banana-studio-linux-alpha_${metadata.debVersion}_amd64.deb`);
  execFileSync('dpkg-deb', ['--root-owner-group', '-Zxz', '-z6', '--build', stage, output], { stdio: 'inherit' });
  const extracted = path.join(stage, 'verification'); fs.mkdirSync(extracted);
  execFileSync('dpkg-deb', ['--extract', output, extracted], { stdio: 'pipe' });
  const verified = assertLinuxBundle(path.join(extracted, 'opt/banana-studio'));
  if (execFileSync('dpkg-deb', ['--field', output, 'Architecture'], { encoding: 'utf8' }).trim() !== 'amd64') throw new Error('Wrong Debian package architecture.');
  fs.writeFileSync(output + '.sha256', sha256(fs.readFileSync(output)) + '  ' + path.basename(output) + '\n');
  complete = true;
  console.log(JSON.stringify({ deb: output, files: verified.files, elfCount: verified.elfCount, installedOrGuiTested: false }));
} finally {
  if (output && !complete) { fs.rmSync(output, { force: true }); fs.rmSync(output + '.sha256', { force: true }); }
  fs.rmSync(stage, { recursive: true, force: true });
}
