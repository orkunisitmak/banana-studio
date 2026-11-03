import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const req = createRequire(import.meta.url);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const out = await build({
  entryPoints: ['./src/components/HistoryPanel.tsx'],
  absWorkingDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'lucide-react'], logLevel: 'silent',
});
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const render = images => renderToStaticMarkup(React.createElement(mod.exports.HistoryPanel, { images, onSelect() {}, isOpen: true, onClose() {} }));
const row = (html, prompt) => html.slice(Math.max(0, html.indexOf(prompt) - 900), html.indexOf(prompt) + 200);

const base = { mediaType: 'image', aspectRatio: '1:1', resolution: '1K', isLoading: false };
const done = { ...base, id: 'ok', url: 'https://x/ok.png', prompt: 'sunny beach', status: 'completed' };
const failed = { ...base, id: 'bad', url: '', prompt: 'rainy street', status: 'failed', error: 'Provider rejected the request.' };

test('a completed generation still shows its thumbnail', () => {
  assert.match(row(render([done]), 'sunny beach'), /<img[^>]+src="https:\/\/x\/ok\.png"/);
});

test('a failed generation is labelled and has no empty image', () => {
  const html = row(render([failed, done]), 'rainy street');
  assert.doesNotMatch(html, /<img(?![^>]*src="[^"]+")[^>]*>/);
  assert.match(html, /Failed/);
  assert.match(html, /title="Provider rejected the request\."/);
});
