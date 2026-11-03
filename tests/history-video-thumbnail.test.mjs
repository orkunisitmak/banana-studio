import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// History panel thumbnails are always <img src={thumbnailUrl || url}>. A saved video whose
// poster could not be made (storageService: "Video thumbnail generation failed", then no
// provider poster) has no thumbnailUrl, so the row puts the .mp4 into an <img> and shows a
// broken image. The Gallery card for the same video renders a <video> preview instead.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + 'package.json');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { build } = req('esbuild');
const out = await build({ entryPoints: ['./src/components/HistoryPanel.tsx'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'lucide-react'], logLevel: 'silent' });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const render = image => renderToStaticMarkup(React.createElement(mod.exports.HistoryPanel, { images: [image], onSelect() {}, isOpen: true, onClose() {} }));
const video = { id: 'v1', mediaType: 'video', url: 'https://x.supabase.co/storage/v1/object/sign/media/u/video_1.mp4?token=t', prompt: 'a clip', isLoading: false, videoQuality: '720p', videoAspectRatio: '16:9', aspectRatio: '16:9', resolution: '720p', createdAt: 1, referenceImages: [] };

test('control: a video with a saved poster shows the poster image', () => {
  const html = render({ ...video, thumbnailUrl: 'https://x/poster.jpg' });
  assert.match(html, /<img[^>]+src="https:\/\/x\/poster\.jpg"/);
});

test('History row for a video without a poster does not load the video file into an <img>', () => {
  const html = render(video);
  const imgs = [...html.matchAll(/<img[^>]*src="([^"]*)"/g)].map(m => m[1]);
  assert.ok(!imgs.some(src => /\.mp4(\?|$)/.test(src)), `History thumbnail <img> sources: ${imgs.join(', ')}`);
});

test('History row for a video without a poster previews the video file in a <video>', () => {
  const tag = render(video).match(/<video[^>]*>/)?.[0];
  assert.ok(tag, 'no <video> preview rendered');
  assert.match(tag, /src="https:\/\/x\.supabase\.co\/[^"]*video_1\.mp4\?token=t#t=0\.1"/);
  assert.match(tag, /preload="metadata"/);
});

test('control: an image row still renders its own <img>', () => {
  const html = render({ ...video, id: 'i1', mediaType: 'image', url: 'https://x/pic.png' });
  assert.match(html, /<img[^>]+src="https:\/\/x\/pic\.png"/);
  assert.doesNotMatch(html, /<video/);
});
