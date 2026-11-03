import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// A Seedance 2.5 Video Edit result is saved with videoDuration -1 ("Auto (source)") and the Seedance
// status routes return no output length, so videoOutputDuration stays empty. Dropping that card on the
// composer (Controls handleDrop: duration: media.videoDuration) attaches it with duration -1, and
// "Use as reference" (App.handleUseAsReference: media.videoOutputDuration || media.videoDuration) does too.
// The composer's Edit price then prices a 5 s source, while the submission (runwayService.createVideoTask
// -> prepareReferenceVideos -> inspectVideo) measures the real 12 s source and saves that estimate on the card.
// An uploaded file gets its length read (uploadReferenceVideo -> readVideoDuration) and is priced right.
// Drives the real Controls drop handler and price (src/components/Controls.tsx) and the real estimateVideoCost.
// The browser's <video> metadata read is the only stand-in: any video URL reports a 12 s duration.
const root = process.cwd();
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const jsxRuntime = req('react/jsx-runtime');

const routeHook = `import { resolveProvider } from '../lib/providers';
export function useProviderRoute(model) {
  const choice = 'auto', available = { evolink: true, fal: true, openrouter: true };
  return { model, choice, available, provider: resolveProvider(model, choice, available) };
}
export function ProviderRouteControl() { return null; }
export function ProviderRoutingSettings() { return null; }`;

// Record the composer bar's drop handler while rendering.
let dropHandler, clearHandler;
const recordingRuntime = { ...jsxRuntime };
for (const name of ['jsx', 'jsxs', 'jsxDEV']) if (jsxRuntime[name]) recordingRuntime[name] = (type, props, ...rest) => {
  if (type === 'div' && props?.onDrop && props?.onPaste) dropHandler = props.onDrop;
  if (type === 'button' && props?.title === 'Clear Prompt & Images') clearHandler = props.onClick;
  return jsxRuntime[name](type, props, ...rest);
};
const bundleRequire = id => id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime' ? recordingRuntime : req(id);

const bundle = async entry => {
  const out = await build({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false,
    format: 'cjs', platform: 'node', logLevel: 'silent', jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'route', setup(b) {
      b.onLoad({ filter: /components[\\/]ProviderRoutingSettings\.tsx$/ }, () => ({ contents: routeHook, loader: 'tsx', resolveDir: `${root}/src/components` }));
    } }],
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, bundleRequire);
  return mod.exports;
};

const SOURCE_SECONDS = 12;
globalThis.window = globalThis;
globalThis.location = { origin: 'http://localhost', hostname: 'localhost', href: 'http://localhost/', search: '', hash: '', pathname: '/' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000000', sessionId: '00000000-0000-0000-0000-000000000000' };
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {},
  createElement: kind => {
    const media = { duration: NaN, removeAttribute() {}, load() {}, setAttribute() {} };
    let src = '';
    Object.defineProperty(media, 'src', { get: () => src, set: value => {
      src = value;
      if (value && kind === 'video') setTimeout(() => {
        if (value.includes('unreadable')) { media.onerror?.(); return; }
        media.duration = SOURCE_SECONDS; media.onloadedmetadata?.();
      }, value.includes('slow') ? 40 : 1);
    } });
    return media;
  } };
req('react-dom').createPortal = node => node;

const { Controls, galleryVideoDuration } = await bundle('./src/components/Controls.tsx');
const { estimateVideoCost } = await bundle('./src/types.ts');

// The saved Video Edit result as the gallery lists it (App placeholder: videoDuration -1 for Edit).
const galleryEditResult = { id: 'v1', mediaType: 'video', url: 'https://example.supabase.co/storage/v1/object/sign/media/u/v1.mp4?token=t',
  prompt: 'make it night', videoModel: 'seedance-2.5', videoOperation: 'edit', videoDuration: -1, videoQuality: '720p', status: 'completed' };

const editConfig = { prompt: 'add falling snow', count: 1, aspectRatio: '16:9', resolution: '1K',
  imageModel: 'gpt-image-2.5-sunburst', referenceImages: [], referenceVideos: [], referenceAudios: [], mode: 'video',
  videoModel: 'seedance-2.5', videoOperation: 'edit', videoAspectRatio: 'adaptive', videoQuality: '720p', videoDuration: -1,
  audioEnabled: true, videoPromptExpansionMode: 'balanced' };
const props = (config, onChange = () => {}) => ({ config, onChange, onGenerate() {}, onBrainstormGenerate() {}, templates: [], onSaveTemplate() {},
  onUpdateTemplate() {}, onDeleteTemplate() {}, onSelectTemplate() {}, activeRequests: 0, generationProgress: null });
const composerPrice = config => {
  const html = renderToStaticMarkup(React.createElement(Controls, props(config)));
  const prices = [...html.matchAll(/~\$(\d+\.\d\d)/g)].map(match => match[1]);
  assert.ok(prices.length, 'Generate button shows a price');
  return prices.at(-1);
};
// What createVideoTask records after inspectVideo measured the source (requestDuration -1, one 12 s video).
const submitted = estimateVideoCost('seedance-2.5', '720p', -1, true, SOURCE_SECONDS, 'edit', SOURCE_SECONDS, 0, undefined).usd.toFixed(2);

const dropGalleryCard = async media => {
  let latest = editConfig;
  const onChange = next => { latest = typeof next === 'function' ? next(latest) : next; };
  dropHandler = undefined;
  renderToStaticMarkup(React.createElement(Controls, props(editConfig, onChange)));
  assert.ok(dropHandler, 'composer drop handler found');
  const payload = JSON.stringify(media);
  await dropHandler({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: { contains: () => false },
    dataTransfer: { types: ['application/nanogen-media'], files: [], getData: type => type === 'application/nanogen-media' ? payload : '' } });
  await new Promise(resolve => setTimeout(resolve, 50));
  return latest;
};

test('control: an uploaded 12 s source (its length read from the file) is priced as the submission records it', () => {
  const uploaded = { id: 'up', url: 'https://example.supabase.co/storage/v1/object/public/media/vref.mp4', mimeType: 'video/mp4', duration: SOURCE_SECONDS };
  assert.equal(composerPrice({ ...editConfig, referenceVideos: [uploaded] }), submitted);
});

test('control: dropping a gallery video with a known length attaches that length', async () => {
  const dropped = await dropGalleryCard({ ...galleryEditResult, id: 'v2', videoOperation: 'generate', videoDuration: 8 });
  assert.equal(dropped.referenceVideos.length, 1);
  assert.equal(dropped.referenceVideos[0].duration, 8);
});

test('Video Edit of a dropped gallery Edit result: the composer price matches what the submission records for its 12 s source', async () => {
  const dropped = await dropGalleryCard(galleryEditResult);
  assert.equal(dropped.referenceVideos.length, 1, 'the dropped video is attached');
  const shown = composerPrice(dropped);
  assert.equal(shown, submitted,
    `attached duration ${dropped.referenceVideos[0].duration}: composer shows ~$${shown} (priced as a 5 s source) next to Edit; the submission measures the 12 s source and saves ~$${submitted} on the gallery card`);
});

test('a draft edit made while the dropped video length is being read is kept', async () => {
  let latest = editConfig;
  const onChange = next => { latest = typeof next === 'function' ? next(latest) : next; };
  dropHandler = undefined;
  renderToStaticMarkup(React.createElement(Controls, props(editConfig, onChange)));
  const payload = JSON.stringify(galleryEditResult);
  const pending = dropHandler({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: { contains: () => false },
    dataTransfer: { types: ['application/nanogen-media'], files: [], getData: type => type === 'application/nanogen-media' ? payload : '' } });
  latest = { ...latest, prompt: 'typed while reading' };
  await pending;
  assert.equal(latest.prompt, 'typed while reading');
  assert.equal(latest.referenceVideos.length, 1);
});

test('an invalid saved output length falls back to the valid saved source length instead of reading the file', async () => {
  const dropped = await dropGalleryCard({ ...galleryEditResult, id: 'v3', videoOutputDuration: -1, videoDuration: 8 });
  assert.equal(dropped.referenceVideos[0].duration, 8);
  assert.equal(await galleryVideoDuration({ url: galleryEditResult.url, videoOutputDuration: -1, videoDuration: 8 }), 8);
});

test('"Use as reference" and drop share galleryVideoDuration: an Edit result with no saved length is measured as 12 s', async () => {
  assert.equal(await galleryVideoDuration({ url: galleryEditResult.url, videoDuration: -1 }), SOURCE_SECONDS);
});

test('a video whose length cannot be read is still attached, with no length', async () => {
  const dropped = await dropGalleryCard({ ...galleryEditResult, id: 'v4', url: 'https://example.supabase.co/media/unreadable.mp4' });
  assert.equal(dropped.referenceVideos.length, 1);
  assert.equal(dropped.referenceVideos[0].duration, undefined);
});

test('two drops that finish reading together attach only one video when the action allows one', async () => {
  let latest = editConfig;
  const onChange = next => { latest = typeof next === 'function' ? next(latest) : next; };
  dropHandler = undefined;
  renderToStaticMarkup(React.createElement(Controls, props(editConfig, onChange)));
  const drop = id => dropHandler({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: { contains: () => false },
    dataTransfer: { types: ['application/nanogen-media'], files: [], getData: type => type === 'application/nanogen-media' ? JSON.stringify({ ...galleryEditResult, id }) : '' } });
  await Promise.all([drop('a'), drop('b')]);
  assert.equal(latest.referenceVideos.length, 1);
});

test('drops are attached in the order they were dropped, even when the first one reads slower', async () => {
  let latest = { ...editConfig, videoOperation: 'generate' };
  const onChange = next => { latest = typeof next === 'function' ? next(latest) : next; };
  dropHandler = undefined;
  renderToStaticMarkup(React.createElement(Controls, props(latest, onChange)));
  const drop = (id, url) => dropHandler({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: { contains: () => false },
    dataTransfer: { types: ['application/nanogen-media'], files: [], getData: type => type === 'application/nanogen-media' ? JSON.stringify({ ...galleryEditResult, id, url, videoDuration: -1 }) : '' } });
  await Promise.all([drop('a', 'https://example.supabase.co/media/slow-a.mp4'), drop('b', 'https://example.supabase.co/media/b.mp4')]);
  assert.deepEqual(latest.referenceVideos.map(video => video.url.split('/').pop()), ['slow-a.mp4', 'b.mp4']);
});

test('Clear while a dropped video length is being read keeps the video out of the cleared draft', async () => {
  let latest = editConfig;
  const onChange = next => { latest = typeof next === 'function' ? next(latest) : next; };
  dropHandler = undefined; clearHandler = undefined;
  renderToStaticMarkup(React.createElement(Controls, props(editConfig, onChange)));
  assert.ok(clearHandler, 'clear button found');
  const payload = JSON.stringify({ ...galleryEditResult, url: 'https://example.supabase.co/media/slow-c.mp4' });
  const pending = dropHandler({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: { contains: () => false },
    dataTransfer: { types: ['application/nanogen-media'], files: [], getData: type => type === 'application/nanogen-media' ? payload : '' } });
  clearHandler();
  await pending;
  assert.equal(latest.prompt, '');
  assert.equal(latest.referenceVideos.length, 0);
});
