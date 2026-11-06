// Build the Docker web server into .build/server (or the given directory): the
// bundled functions and gateway, the built frontend, the Supabase migrations and
// sharp's installed runtime closure for this platform. Run after `npm run build`.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.resolve(process.argv[2] || path.join(root, '.build/server'));
if (!fs.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Missing dist/index.html. Run npm run build first.');
fs.rmSync(target, { recursive: true, force: true }); fs.mkdirSync(target, { recursive: true });

await build({
  entryPoints: [path.join(root, 'docker/server/main.mjs')], outfile: path.join(target, 'server.mjs'),
  platform: 'node', target: 'node24', format: 'esm', bundle: true, packages: 'bundle', external: ['sharp'], sourcemap: false,
  banner: { js: "import { createRequire as __bananaCreateRequire } from 'node:module'; const require = __bananaCreateRequire(import.meta.url);" },
  plugins: [{ name: 'self-hosted-queue', setup(build) {
    // Vercel Queues become the in-process worker; every other module is the hosted code.
    build.onResolve({ filter: /imageJobQueue\.(js|ts)$/ }, args => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (path.dirname(resolved) !== path.join(root, 'api/_lib')) return;
      return { path: path.join(root, 'docker/server/queue.mjs') };
    });
  } }],
});
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'banana-studio-server', private: true, type: 'module' }));
fs.cpSync(path.join(root, 'dist'), path.join(target, 'web'), { recursive: true });
fs.cpSync(path.join(root, 'supabase/migrations'), path.join(target, 'migrations'), { recursive: true });
fs.cpSync(path.join(root, 'docker/server/pages'), path.join(target, 'pages'), { recursive: true });

const copied = new Map();
/** Find an installed package the way Node resolves it from `from`. */
const resolvePackage = (name, from) => {
  for (let directory = from; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (directory === path.dirname(directory)) return null;
  }
};
/** Copy a runtime package and its dependencies into the build, refusing version conflicts. */
const copyPackage = (name, from, optional = false) => {
  const source = resolvePackage(name, from);
  if (!source) { if (optional) return; throw new Error('Missing runtime dependency: ' + name); }
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  if (copied.has(name)) { if (copied.get(name) !== pkg.version) throw new Error('Conflicting runtime dependency: ' + name); return; }
  copied.set(name, pkg.version);
  fs.cpSync(source, path.join(target, 'node_modules', name), { recursive: true, dereference: true, filter: file => !['node_modules', '.git'].includes(path.basename(file)) });
  for (const dependency of Object.keys(pkg.dependencies || {})) copyPackage(dependency, source);
  // npm installs only the optional binaries that match this platform.
  for (const dependency of Object.keys(pkg.optionalDependencies || {})) copyPackage(dependency, source, true);
};
copyPackage('sharp', root);
if (![...copied.keys()].some(name => name.startsWith(`@img/sharp-${process.platform}`))) throw new Error(`The ${process.platform}-${process.arch} image codec is missing.`);
console.log(`Built the Docker web server in ${path.relative(root, target) || '.'}.`);
