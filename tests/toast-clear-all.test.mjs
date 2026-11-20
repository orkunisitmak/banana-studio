import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + 'package.json');
const { build } = req('esbuild');
// Minimal hook host for useToast, whose only state is one useState: the state survives between calls.
const reactStub = `let slot, set = false;
export const useState = init => { if (!set) { slot = typeof init === 'function' ? init() : init; set = true; }
  return [slot, next => { slot = typeof next === 'function' ? next(slot) : next; }]; };
export const useEffect = () => {}; export default { useState, useEffect, createElement() {} };`;
const out = await build({
  entryPoints: ['./src/components/Toast.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'host', setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }));
    b.onResolve({ filter: /^react\/jsx-runtime$|^lucide-react$/ }, a => ({ path: a.path, namespace: 'noop' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: reactStub, loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'noop' }, () => ({ contents: 'module.exports = new Proxy({}, { get: () => () => null });', loader: 'js' }));
  } }],
});
const host = () => { const m = { exports: {} }; new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, req); return m.exports.useToast; };

test('Clear All keeps the entries of generations that are still running', () => {
  const hook = host();
  // useState is the hook's only state; every call to the hook reads the same slot.
  let toast = hook();
  const running = toast.loading('Generating 4 images...', 'Please wait while your images are being created.');
  toast = hook(); toast.success('Reference Added', 'Image added as reference.');
  toast = hook(); toast.info('Settings Loaded', 'Prompt and references loaded.');
  toast = hook();
  assert.equal(toast.toasts.length, 3);
  toast.dismissAll(); // Gallery notification panel: "Clear All"
  toast = hook();
  toast.updateToast(running, { progress: 50 }); // the batch keeps reporting progress
  toast = hook();
  const left = toast.toasts.map(t => `${t.type}:${t.title}${t.progress != null ? ` ${t.progress}%` : ''}`);
  assert.deepEqual(left, ['loading:Generating 4 images... 50%'], `after Clear All while 4 images are generating: [${left.join(', ')}]`);
});
