import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Renders the real Controls (src/components/Controls.tsx) for Nano Banana Pro when the user picked the
// fal.ai route in AI settings and no fal.ai key is configured (OpenRouter, used for text, is configured).
// The route state comes from the real resolveProvider (src/lib/providers.ts); only the hook that would
// fetch /api/gemini-status and read the saved preference is replaced by that fixed answer.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const PANEL = 'const [isBrainstormPanelOpen, setIsBrainstormPanelOpen] = useState(false)';

const routeHook = available => `import { resolveProvider } from '../lib/providers';
export function useProviderRoute(model) {
  const choice = 'fal', available = ${JSON.stringify(available)};
  try { return { model, choice, available, provider: resolveProvider(model, choice, available) }; }
  catch (error) { return { model, choice, available, provider: choice, error: error.message }; }
}
export function ProviderRouteControl() { return null; }
export function ProviderRoutingSettings() { return null; }`;

async function loadControls(panelOpen, available = { openrouter: true }) {
  const out = await build({
    entryPoints: ['./src/components/Controls.tsx'], absWorkingDir: root, bundle: true, write: false,
    format: 'cjs', platform: 'node', logLevel: 'silent',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'route', setup(b) {
      b.onLoad({ filter: /components[\\/]ProviderRoutingSettings\.tsx$/ }, () => ({ contents: routeHook(available), loader: 'tsx', resolveDir: `${root}/src/components` }));
      if (panelOpen) b.onLoad({ filter: /components[\\/]Controls\.tsx$/ }, args => {
        const src = fs.readFileSync(args.path, 'utf8');
        assert.ok(src.includes(PANEL), 'Brainstorm panel state not found');
        return { contents: src.replace(PANEL, PANEL.replace('(false)', '(true)')), loader: 'tsx' };
      });
    } }],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports.Controls;
}

globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', hostname: 'localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} };
req('react-dom').createPortal = node => node;

const photo = { id: 'ref1', data: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' };
const config = { prompt: 'a product shot on a beach', count: 1, aspectRatio: '16:9', resolution: '1K', imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [photo], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'seedance-2.5', videoOperation: 'generate',
  videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: false, videoPromptExpansionMode: 'balanced' };
const props = { config, onChange() {}, onGenerate() {}, onBrainstormGenerate() {}, templates: [], onSaveTemplate() {},
  onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {}, activeRequests: 0, generationProgress: null };
const KEY_MESSAGE = 'Add your fal.ai key in Provider keys, or choose Auto in AI settings.';

test('control: with the fal.ai route unavailable, Generate is disabled and the composer shows the key message', async () => {
  const html = renderToStaticMarkup(React.createElement(await loadControls(false), props));
  assert.ok(html.includes(KEY_MESSAGE), 'route message rendered');
  const generate = html.match(/<button[^>]*title="Add your fal\.ai key[^"]*"[^>]*>/)?.[0];
  assert.ok(generate, 'Generate button carries the route message');
  assert.match(generate, /\sdisabled=""/);
});

test('Brainstorm & generate is also blocked while the image route cannot run, before the paid Brainstorm text request', async () => {
  const html = renderToStaticMarkup(React.createElement(await loadControls(true), props));
  const button = html.match(/<button[^>]*aria-label="Generate brainstorm images"[^>]*>/)?.[0];
  assert.ok(button, 'Brainstorm panel rendered');
  assert.match(button, /\sdisabled=""/,
    `"Brainstorm & generate" is enabled although Nano Banana Pro cannot be routed (${KEY_MESSAGE}): ${button}`);
  assert.ok(button.includes(`title="${KEY_MESSAGE}"`), `the disabled button explains why: ${button}`);
});

test('control: Brainstorm & generate stays enabled when the fal.ai route has a key', async () => {
  const html = renderToStaticMarkup(React.createElement(await loadControls(true, { openrouter: true, fal: true }), props));
  const button = html.match(/<button[^>]*aria-label="Generate brainstorm images"[^>]*>/)?.[0];
  assert.ok(button, 'Brainstorm panel rendered');
  assert.doesNotMatch(button, /\sdisabled=""/);
  assert.ok(!html.includes(KEY_MESSAGE), 'no route message when the route works');
});
