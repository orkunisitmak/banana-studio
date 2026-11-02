import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + '/package.json')('esbuild');
const compiled = await build({
  entryPoints: [root + '/src/components/Toast.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'fixture', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime|lucide-react)$/ }, a => ({ path: a.path, namespace: 'fx' }));
    b.onLoad({ filter: /.*/, namespace: 'fx' }, a => ({ loader: 'js', contents: a.path === 'react'
      ? 'export const useState = v => [true, () => {}]; export const useEffect = () => {}; export default { useState, useEffect };'
      : a.path === 'lucide-react' ? 'const i = () => null; export const X = i, CheckCircle = i, AlertCircle = i, AlertTriangle = i, Info = i, Loader2 = i;'
      : 'export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;' }));
  } }],
});
const { ToastContainer } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);

const render = toasts => text(ToastContainer({ toasts, onDismiss() {} }));

test('minimized summary counts one loading toast as one task', () => {
  const out = render([{ id: 'a', type: 'loading', title: 'Creating variation...' }, { id: 'b', type: 'success', title: 'Saved' }]);
  assert.match(out, /Generating 1 task\.\.\./, out);
});

test('minimized summary counts several loading toasts without doubling', () => {
  const out = render([1, 2, 3].map(n => ({ id: String(n), type: 'loading', title: 'Working' })));
  assert.match(out, /Generating 3 tasks\.\.\./, out);
});
