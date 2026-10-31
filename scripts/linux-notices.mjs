import fs from 'node:fs';
import path from 'node:path';

export function linuxNotices(root, runtimeDirectory) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, '.build/desktop/metafile.json')));
  const inputs = Object.values(meta.outputs).flatMap(output => Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name));
  inputs.push(...JSON.parse(fs.readFileSync(path.join(root, '.build/web-modules.json'))));
  const packages = new Map();
  for (const input of inputs) {
    if (!input.includes('node_modules/')) continue;
    let recorded = false;
    let directory = path.dirname(path.resolve(root, input.replace(/^\0/, '')));
    while (directory.startsWith(path.join(root, 'node_modules') + path.sep)) {
      if (fs.existsSync(path.join(directory, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
        if (pkg.name && pkg.version) { packages.set(pkg.name + '@' + pkg.version, { ...pkg, directory }); recorded = true; break; }
      }
      directory = path.dirname(directory);
    }
    if (!recorded) throw new Error('Build metadata or dependencies belong to another checkout. Rebuild frontend and desktop before packaging.');
  }
  if (!packages.size) throw new Error('Missing bundled JavaScript license inventory. Rebuild frontend and desktop.');
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const next = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) visit(next);
      else {
        const pkg = JSON.parse(fs.readFileSync(path.join(next, 'package.json')));
        packages.set(pkg.name + '@' + pkg.version, { ...pkg, directory: next });
      }
    }
  };
  visit(runtimeDirectory);
  const sections = ['# Linux alpha third-party notices\n\nGenerated from modules included in the frontend/workspace and the six pinned image runtime packages. Electron/Chromium and Node retain their complete accompanying license files.\n'];
  for (const [name, pkg] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = fs.readdirSync(pkg.directory).filter(file => /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file) && fs.statSync(path.join(pkg.directory, file)).isFile());
    const supplemental = path.join(root, 'docs/third-party-licenses', pkg.name.replaceAll('/', '-') + '-' + pkg.version + '-LICENSE.txt');
    sections.push(`## ${name}\n\nDeclared license: ${pkg.license || 'See license text'}\n`);
    if (files.length) for (const file of files) sections.push(fs.readFileSync(path.join(pkg.directory, file), 'utf8'));
    else if (fs.existsSync(supplemental)) sections.push(fs.readFileSync(supplemental, 'utf8'));
    else {
      const readme = fs.readdirSync(pkg.directory).find(name => /^readme/i.test(name));
      const excerpt = readme && fs.readFileSync(path.join(pkg.directory, readme), 'utf8').match(/(?:^|\n)(?:#+\s*License[^\n]*\n|License\s*\n[-=]+\n)([\s\S]*)/i)?.[1];
      if (!excerpt || !/Permission (?:is hereby granted|to use, copy)/.test(excerpt)) throw new Error('Missing complete Linux dependency license: ' + name);
      sections.push(excerpt);
    }
  }
  return sections.join('\n\n');
}
