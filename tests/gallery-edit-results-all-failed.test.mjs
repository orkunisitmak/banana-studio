import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Gallery image editor > Edit results: once nothing is pending, the status always reads
// "✓ Saved in gallery" (or "Available in gallery"), even when every edit failed and
// nothing was saved. The same header says "0 ready · 1 failed".
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + 'package.json');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { build } = req('esbuild');
const out = await build({ entryPoints: ['./src/components/GalleryEditResults.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'lucide-react'], logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const status = jobs => {
  const html = renderToStaticMarkup(React.createElement(mod.exports.GalleryEditResults, { source: { id: 's', url: 'https://x/s.png', mediaType: 'image' }, jobs, onSelect() {} }));
  const header = html.match(/Edit results <span[^>]*>([^<]*)</)?.[1];
  const live = html.match(/<span role="status"[^>]*>(.*?)<\/span>/)?.[1].replace(/<[^>]+>/g, '');
  return { header, live };
};
const job = (id, extra) => ({ id, mediaType: 'image', url: '', prompt: 'make the wall red', createdAt: 1, imageModel: 'gemini-nano-banana-2.1', ...extra });

test('control: a completed edit reports Saved in gallery', () => {
  assert.deepEqual(status([job('e1', { url: 'https://x/e1.png', status: 'completed' })]), { header: '1 ready', live: 'Saved in gallery' });
});

test('when every edit failed the status does not say the result was saved', () => {
  const s = status([job('e1', { status: 'failed', error: 'Gemini returned no image.' })]);
  assert.ok(!/Saved in gallery|Available in gallery/.test(s.live), `header "${s.header}", status "${s.live}"`);
});

test('a failed edit next to a completed one still reports the saved result', () => {
  const s = status([job('e1', { url: 'https://x/e1.png', status: 'completed' }), job('e2', { status: 'failed', error: 'Gemini returned no image.' })]);
  assert.deepEqual(s, { header: '1 ready · 1 failed', live: 'Saved in gallery' });
});
