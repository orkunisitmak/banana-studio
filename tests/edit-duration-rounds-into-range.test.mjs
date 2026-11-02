import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Video Edit rejects a source clip outside 4-30 seconds. The message must not
// print a duration that, as shown, sits inside the accepted range.
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + '/package.json')('esbuild');
const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:null}})}};',
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
  '/providerRouting': 'export const selectProvider=()=>"evolink";',
};
const compiled = await build({ entryPoints: ['src/services/runwayService.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /.*/ }, a => { const key = Object.keys(stubs).find(s => a.path.endsWith(s)); return key ? { path: key, namespace: 'stub' } : undefined; });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, a => ({ path: import.meta.resolve(a.path), external: true }));
  } }] });
const { validateEditSourceMetadata } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const message = duration => { try { validateEditSourceMetadata({ duration, width: 1280, height: 720 }, 'Source video'); } catch (e) { return e.message; } return ''; };
const shown = text => Number(text.match(/Current duration is ([\d.]+)s/)?.[1]);

test('control: a clearly too long clip reports its length', () => {
  assert.equal(shown(message(45)), 45);
});
test('a 30.04 s clip is not reported as 30.0 s in a 4-30 s rule', () => {
  assert.ok(shown(message(30.04)) > 30, message(30.04));
});
test('a 3.96 s clip is not reported as 4.0 s in a 4-30 s rule', () => {
  assert.ok(shown(message(3.96)) < 4, message(3.96));
});

test('control: 30.001 s and 3.999 s are not shown as the limit', () => {
  assert.ok(shown(message(30.001)) > 30, message(30.001));
  assert.ok(shown(message(3.999)) < 4, message(3.999));
});

// The local-reference path: createVideoTask -> prepareReferenceVideos ->
// resolveReferenceMediaUrl -> validateLocalReferenceMedia.
const { createVideoTask } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const localEditMessage = async seconds => {
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = { createElement: () => {
    const el = { duration: seconds, videoWidth: 1280, videoHeight: 720, removeAttribute() {}, load() {}, pause() {} };
    Object.defineProperty(el, 'src', { set() { queueMicrotask(() => el.onloadedmetadata?.()); } });
    return el;
  } };
  globalThis.fetch = async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'video/mp4' }) });
  try {
    await createVideoTask({ prompt: 'edit', referenceImages: [], referenceAudios: [], referenceVideos: [{ id: 'v1', url: 'blob:local', mimeType: 'video/mp4' }],
      videoModel: 'seedance-2.5', videoOperation: 'edit', videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5 });
  } catch (e) { return e.message; }
  return '';
};
test('a local 30.04 s reference is not reported as 30.0 s', async () => {
  const text = await localEditMessage(30.04);
  assert.match(text, /Current duration is/, text);
  assert.ok(shown(text) > 30, text);
});
test('a local 3.96 s reference is not reported as 4.0 s', async () => {
  const text = await localEditMessage(3.96);
  assert.match(text, /Current duration is/, text);
  assert.ok(shown(text) < 4, text);
});
