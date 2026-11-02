import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';

// Renders the real Controls with the Templates menu open and one saved template.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const OPEN = 'const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)';

const out = await build({
  entryPoints: ['./src/components/Controls.tsx'], absWorkingDir: root, bundle: true, write: false,
  format: 'cjs', platform: 'node', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  plugins: [{ name: 'open-templates', setup(b) {
    b.onLoad({ filter: /components[\\/]Controls\.tsx$/ }, args => {
      const src = fs.readFileSync(args.path, 'utf8');
      assert.ok(src.includes(OPEN), 'template menu state not found');
      return { contents: src.replace(OPEN, OPEN.replace('(false)', '(true)')), loader: 'tsx' };
    });
  } }],
});
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', hostname: 'localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} };
req('react-dom').createPortal = node => node;
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const { Controls } = mod.exports;

const config = { prompt: 'a cat', count: 1, aspectRatio: '16:9', resolution: '1K', imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'seedance-2.5', videoOperation: 'generate',
  videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'balanced' };
const template = { id: 't1', name: 'Product hero', createdAt: 1, config };
const html = renderToStaticMarkup(React.createElement(Controls, { config, onChange() {}, onGenerate() {}, onBrainstormGenerate() {},
  templates: [template], onSaveTemplate() {}, onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {},
  activeRequests: 0, generationProgress: null }));

// Open start tags enclosing the first occurrence of `marker`.
const enclosing = marker => {
  const at = html.indexOf(marker);
  assert.ok(at >= 0, `${marker} not rendered`);
  const open = [];
  for (const [tag] of html.slice(0, at).matchAll(/<\/?[a-z]+\b[^>]*>/g)) {
    if (/^<\/(path|circle|rect|line|polyline)\b/.test(tag)) continue;
    if (tag.startsWith('</')) open.pop(); else if (!/^<(img|input|br|hr|path|circle|rect|line|polyline)\b|\/>$/.test(tag)) open.push(tag);
  }
  return open;
};

test('control: the open Templates menu lists the saved template with Update and Delete', () => {
  assert.ok(html.includes('>Product hero<'));
  assert.match(html, /title="Update with current settings"/);
  assert.match(html, /title="Delete"/);
});

test('a saved template can be applied from the keyboard', () => {
  const row = enclosing('>Product hero<');
  const operable = row.filter(tag => /^<button\b/.test(tag) || (/role="button"/.test(tag) && /tabindex="0"/i.test(tag)));
  assert.ok(operable.length, `the template name sits only in non-focusable elements, so Tab never reaches it and Enter cannot apply it:\n${row.slice(-3).join('\n')}`);
});

test('the template Update and Delete buttons become visible when they get keyboard focus', () => {
  const actions = enclosing('title="Update with current settings"').at(-1);
  assert.match(actions, /opacity-0/);
  assert.match(actions, /focus-within:opacity-100|focus-visible:opacity-100/,
    `Update / Delete wrapper is "${actions.match(/class="([^"]*)"/)[1]}": transparent until mouse hover, also when a button inside it has focus`);
});
