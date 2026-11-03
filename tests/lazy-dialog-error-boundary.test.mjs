import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  entryPoints: [`${root}/src/components/LazyDialogErrorBoundary.tsx`],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [{ name: 'react-fixture', setup(build) {
    build.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'react'
      ? 'export default { Component: class { constructor(props) { this.props = props; } } };'
      : 'export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx;' }));
  } }],
});
const { LazyDialogErrorBoundary } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const childrenOf = node => [node?.props?.children].flat().filter(Boolean);
const find = (node, type) => node?.type === type ? node : childrenOf(node).map(child => find(child, type)).find(Boolean);

test('a failed lazy dialog shows a reload action without replacing the gallery', t => {
  const child = { type: 'dialog' };
  const boundary = new LazyDialogErrorBoundary({ children: child });
  assert.equal(boundary.render(), child);

  boundary.state = LazyDialogErrorBoundary.getDerivedStateFromError(new Error('missing chunk'));
  const fallback = boundary.render();
  assert.equal(fallback.props.role, 'alert');
  assert.match(fallback.props.className, /fixed inset-0/);
  assert.match(find(fallback, 'p').props.children, /could not load/);

  let reloads = 0;
  const previousWindow = globalThis.window;
  globalThis.window = { location: { reload: () => { reloads++; } } };
  t.after(() => { globalThis.window = previousWindow; });
  const button = find(fallback, 'button');
  assert.equal(button.props.children, 'Reload');
  button.props.onClick();
  assert.equal(reloads, 1);
});

test('the editor fallback stays inside the detail view', () => {
  const boundary = new LazyDialogErrorBoundary({ children: null, inline: true });
  boundary.state = LazyDialogErrorBoundary.getDerivedStateFromError(new Error('missing chunk'));
  assert.doesNotMatch(boundary.render().props.className, /fixed inset-0/);
});
