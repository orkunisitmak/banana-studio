import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
async function load(entry, plugins = []) {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' }, plugins,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports;
}
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null };
const { renderToStaticMarkup } = req('react-dom/server');
const React = req('react');

const openBrainstorm = {
  name: 'open-brainstorm',
  setup(b) {
    b.onLoad({ filter: /components[\\/]Controls\.tsx$/ }, async a => {
      const fs = await import('node:fs');
      const src = fs.readFileSync(a.path, 'utf8');
      const anchor = /useState\(false\);(\r?\n\s*const \[brainstormIdeaCount)/;
      assert.ok(anchor.test(src), 'anchor missing');
      return { contents: src.replace(anchor, 'useState(true);$1'), loader: 'tsx' };
    });
  },
};
req('react-dom').createPortal = node => node;
const { Controls } = await load('src/components/Controls.tsx', [openBrainstorm]);
const config = { prompt: 'a cat', count: 1, aspectRatio: '16:9', resolution: '1K', imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'veo', videoOperation: 'generate',
  videoAspectRatio: '16:9', videoQuality: 'standard', videoDuration: 8, audioEnabled: false, videoPromptExpansionMode: 'off' };
const html = renderToStaticMarkup(React.createElement(Controls, { config, onChange() {}, onGenerate() {}, onBrainstormGenerate() {}, templates: [], activeRequests: 0, generationProgress: null }));
const buttons = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<\/button>/g) || [];
const category = label => buttons.find(b => new RegExp('>\\s*' + label + '\\s*</button>$').test(b) && /uppercase tracking-wide/.test(b));

test('Brainstorm category buttons expose the selected category with aria-pressed', () => {
  assert.match(html, /Brainstorm Ideas/);
  assert.match(category('Simple'), /aria-pressed="false"/);
  assert.match(category('YouTube'), /aria-pressed="true"/);
});
