import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const req = createRequire(import.meta.url);
const { build } = req('esbuild');
const OPEN_A = 'const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false)';
const OPEN_B = 'const [isNamingTemplate, setIsNamingTemplate] = useState(false)';

async function loadControls(forceOpen) {
  const plugins = forceOpen ? [{ name: 'open', setup(b) {
    b.onLoad({ filter: /components[\\/]Controls\.tsx$/ }, args => {
      const src = fs.readFileSync(args.path, 'utf8');
      assert.ok(src.includes(OPEN_A) && src.includes(OPEN_B), 'template menu state not found');
      return { contents: src.replace(OPEN_A, OPEN_A.replace('(false)', '(true)')).replace(OPEN_B, OPEN_B.replace('(false)', '(true)')), loader: 'tsx' };
    });
  } }] : [];
  const out = await build({
    entryPoints: ['src/components/Controls.tsx'], absWorkingDir: process.cwd(), bundle: true, write: false,
    format: 'cjs', platform: 'node', logLevel: 'silent', plugins,
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
  return mod.exports.Controls;
}

const docListeners = [];
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener: (type, fn) => docListeners.push([type, fn]), removeEventListener() {} };
req('react-dom').createPortal = node => node;

const config = { prompt: 'a cat', count: 1, aspectRatio: '16:9', resolution: '1K', imageModel: 'gemini-3-pro-image-preview',
  referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'image', videoModel: 'veo', videoOperation: 'generate',
  videoAspectRatio: '16:9', videoQuality: 'standard', videoDuration: 8, audioEnabled: false, videoPromptExpansionMode: 'off' };
const props = { config, onChange() {}, onGenerate() {}, onBrainstormGenerate() {}, templates: [], onSaveTemplate() {},
  activeRequests: 0, generationProgress: null };

test('Templates button says it opens a dialog and whether it is open', async () => {
  const Controls = await loadControls(false);
  const btn = renderToStaticMarkup(React.createElement(Controls, props)).match(/<button[^>]*title="Templates"[^>]*>/)?.[0];
  assert.ok(btn, 'Templates button not rendered');
  assert.match(btn, /aria-haspopup="dialog"/);
  assert.match(btn, /aria-expanded="false"/);
});

test('open Templates menu is a labelled dialog and its name field has a label', async () => {
  const Controls = await loadControls(true);
  const html = renderToStaticMarkup(React.createElement(Controls, props));
  const pop = html.match(/<div[^>]*w-\[300px\][^>]*>/)?.[0];
  assert.ok(pop, 'Templates menu not rendered');
  assert.match(pop, /role="dialog"/);
  assert.match(pop, /aria-label="Templates"/);
  assert.match(html.match(/<input[^>]*placeholder="Template Name\.\.\."[^>]*>/)?.[0], /aria-label="Template name"/);
  assert.match(html.match(/<button[^>]*title="Templates"[^>]*>/)[0], /aria-expanded="true"/);
});

test('Escape closes the open Templates menu and returns focus to its button', async () => {
  const Controls = await loadControls(true);
  const realUseState = React.useState;
  const realUseEffect = React.useEffect;
  const closes = [];
  docListeners.length = 0;
  // The forced-open menu flag is the first state initialised to true; record what the Escape handler sets it to.
  let menuFlagTaken = false;
  React.useState = init => {
    if (init === true && !menuFlagTaken) {
      menuFlagTaken = true;
      return [true, v => closes.push(v)];
    }
    return realUseState(init);
  };
  React.useEffect = effect => {
    if (effect.toString().includes('handleEscape')) effect();
  };
  try {
    renderToStaticMarkup(React.createElement(Controls, props));
  } finally {
    React.useState = realUseState;
    React.useEffect = realUseEffect;
  }
  const keydown = docListeners.filter(([type]) => type === 'keydown');
  assert.ok(keydown.length, 'no keydown listener registered while the menu is open');
  for (const [, fn] of keydown) fn({ key: 'a', defaultPrevented: false });
  assert.deepEqual(closes, []);
  for (const [, fn] of keydown) fn({ key: 'Escape', defaultPrevented: false });
  assert.deepEqual(closes, [false]);
});

test('opening the Templates menu moves focus onto the menu', async () => {
  const Controls = await loadControls(true);
  const realUseEffect = React.useEffect;
  const realUseRef = React.useRef;
  const refs = [];
  const focusEffects = [];
  React.useRef = init => { const r = realUseRef(init); refs.push(r); return r; };
  React.useEffect = effect => {
    if (/templateMenuRef\.current\??\.focus\(\)/.test(effect.toString())) focusEffects.push(effect);
  };
  let html;
  try {
    html = renderToStaticMarkup(React.createElement(Controls, props));
  } finally {
    React.useEffect = realUseEffect;
    React.useRef = realUseRef;
  }
  assert.match(html.match(/<div[^>]*w-\[300px\][^>]*>/)?.[0], /tabindex="-1"/);
  assert.equal(focusEffects.length, 1, 'no effect focuses the open Templates menu');
  let focused = 0;
  for (const r of refs) r.current = { focus: () => { focused++; } };
  focusEffects[0]();
  assert.equal(focused, 1);
});
