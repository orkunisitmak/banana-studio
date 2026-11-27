import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The YouTube preview footer says "Airrack, MrBeast & Ryan Trahan examples from the same date",
// but the feed around the user's thumbnail shows the fictional PREVIEW_EXAMPLES channels
// (Studio Atlas, Everyday Experiments, Window Seat), documented as "Fictional, locally authored
// examples. No external channel photos". The footer credits creators that are not on screen.
const deps = fileURLToPath(new URL('..', import.meta.url));
const root = deps;
const req = createRequire(deps + 'package.json');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { build } = req('esbuild');
globalThis.window = globalThis; globalThis.innerWidth = 1440;
globalThis.document = { body: { style: {} }, addEventListener() {}, removeEventListener() {} };
const out = await build({ entryPoints: ['./src/components/YouTubePreviewDialog.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react-dom', 'lucide-react'], logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, p => p === 'react-dom' ? { ...req('react-dom'), createPortal: node => node } : req(p));
const html = renderToStaticMarkup(React.createElement(mod.exports.YouTubePreviewDialog, {
  media: { id: 'm1', url: 'https://x/m.png', mediaType: 'image', prompt: 'p', createdAt: 1 }, initialTitle: 'My video', currentIndex: 0, totalImages: 1,
  favoritesOnly: false, onNavigate() {}, onClose() {}, refreshSource: async () => 'https://x/m.png',
}));
const channels = [...new Set([...html.matchAll(/<p class="ytp-metadata"><span>([^<]+)<\/span>/g)].map(m => m[1]))];
const footer = html.match(/<footer class="ytp-footer">([^<]*)<\/footer>/)?.[1].replace(/&amp;/g, '&') || '';

test('control: the preview feed renders its sample channels', () => {
  assert.ok(channels.includes('Studio Atlas') && channels.includes('Your channel'), `channels: ${channels.join(', ')}`);
});

test('every creator the footer credits for the examples is shown in the feed', () => {
  const credited = ['Airrack', 'MrBeast', 'Ryan Trahan'].filter(name => footer.includes(name));
  const missing = credited.filter(name => !channels.includes(name));
  assert.deepEqual(missing, [], `footer: "${footer}"; feed channels: ${channels.join(', ')}`);
});

test('the footer says the other videos are fictional examples', () => {
  assert.match(footer, /fictional examples/);
});
