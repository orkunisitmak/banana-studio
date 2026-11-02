import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const req = createRequire(import.meta.url);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const out = await build({ entryPoints: [new URL('../src/components/HistoryPanel.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'lucide-react'], logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);

const chips = image => [...renderToStaticMarkup(React.createElement(mod.exports.HistoryPanel, { images: [image], onSelect() {}, isOpen: true, onClose() {} })).matchAll(/font-mono[^>]*>([^<]+)</g)].map(m => m[1]);
const base = { id: 'm1', url: 'https://x/m', thumbnailUrl: 'https://x/t.jpg', prompt: 'p', isLoading: false };

test('History chips show a video\'s own quality and ratio, not the placeholder defaults', () => {
  assert.deepEqual(chips({ ...base, mediaType: 'video', aspectRatio: '16:9', resolution: '1K', videoAspectRatio: '9:16', videoQuality: '1080p' }), ['1080p', '9:16']);
});

test('History chips for an image still show its resolution and ratio', () => {
  assert.deepEqual(chips({ ...base, mediaType: 'image', aspectRatio: '3:4', resolution: '2K' }), ['2K', '3:4']);
});
