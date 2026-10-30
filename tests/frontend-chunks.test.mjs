import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('secondary UI and ZIP stay outside the initial application graph', async () => {
  const result = await build({ entryPoints: ['src/App.tsx'], bundle: true, splitting: true, write: false,
    outdir: '/tmp/banana-chunk-test', format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const outputs = result.metafile.outputs;
  const entry = Object.keys(outputs).find(path => outputs[path].entryPoint === 'src/App.tsx');
  const initial = new Set();
  const visit = path => { if (initial.has(path)) return; initial.add(path); for (const dep of outputs[path]?.imports || []) if (dep.kind !== 'dynamic-import') visit(dep.path); };
  visit(entry);
  const inputs = [...initial].flatMap(path => Object.keys(outputs[path]?.inputs || {}));
  for (const feature of ['jszip', 'AdminPanel.tsx', 'GalleryImageEditor.tsx', 'ImageCompareDialog.tsx', 'HelpCenter.tsx', 'YouTubePreviewDialog.tsx']) {
    assert.ok(!inputs.some(path => path.includes(feature)), `${feature} should load only when requested`);
  }
});

test('lazy dialog fallback announces loading and offers a keyboard-accessible dismissal', async () => {
  const compiled = await build({ entryPoints: ['src/components/LazyFeature.tsx'], bundle: true, write: false, format: 'esm', platform: 'node', external: ['react'], logLevel: 'silent' });
  // Keep normal React module resolution for this small SSR probe.
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const path = await mkdtemp(new URL('../.lazy-feature-test-', import.meta.url).pathname);
  try {
    await writeFile(`${path}/feature.mjs`, compiled.outputFiles[0].text);
    const { LazyFeature } = await import(`${path}/feature.mjs`);
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const Pending = React.lazy(() => new Promise(() => {}));
    const render = inline => renderToStaticMarkup(React.createElement(LazyFeature, { label: 'Image comparison', inline, onClose() {} }, React.createElement(Pending)));
    const modal = render(false);
    assert.match(modal, /role="dialog"/);
    assert.match(modal, /aria-label="Image comparison"/);
    assert.match(modal, /role="status"/);
    assert.match(modal, /<button[^>]*>Cancel<\/button>/);
    assert.doesNotMatch(render(true), /role="dialog"/);
  } finally { await rm(path, { recursive: true, force: true }); }
});
