import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Seedance 2.0 takes at most 9 images. A Continue video whose ratio differs from the target is replaced by an
// extracted first-frame image, so 9 images plus that video would send 10. Run the real createVideoTask.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"https://cdn.example/frame.jpg";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
  '/providerRouting': 'export const selectProvider=async()=>"evolink";',
};
const compiled = await build({ entryPoints: ['src/services/runwayService.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(stub => args.path.endsWith(stub)); return key ? { path: key, namespace: 'stub' } : undefined; });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: req.resolve(args.path), external: true }));
  } }] });
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, p => req(p));
const { createVideoTask } = mod.exports;

// A portrait 1080x1920 clip: it does not match the 16:9 target, so the app extracts its last frame.
const extractions = { count: 0 };
globalThis.window = globalThis;
globalThis.document = { createElement: kind => kind === 'canvas'
  ? { getContext: () => ({ drawImage() {} }), toDataURL: () => { extractions.count++; return 'data:image/jpeg;base64,AAAA'; } }
  : { videoWidth: globalThis.__w, videoHeight: globalThis.__h, duration: 5, removeAttribute() {}, load() {}, pause() {},
      set src(_) { queueMicrotask(() => { this.onloadedmetadata?.(); }); },
      set currentTime(_) { queueMicrotask(() => { this.onseeked?.(); }); } } };
globalThis.__w = 1080; globalThis.__h = 1920;
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, body: init?.body }); return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }); };

const image = i => ({ id: `img-${i}`, data: `https://cdn.example/ref-${i}.png`, mimeType: 'image/png' });
const config = {
  mode: 'video', prompt: 'Continue the shot', count: 1, imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K',
  videoModel: 'seedance-2.0', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: false,
  videoPromptExpansionMode: 'disabled',
  referenceImages: Array.from({ length: 9 }, (_, i) => image(i)),
  referenceVideos: [{ id: 'v1', url: 'https://cdn.example/prev.mp4', mimeType: 'video/mp4', duration: 5, isContinuation: true }],
  referenceAudios: [],
};

test('9 images plus a Continue video of another ratio stops before extracting the frame, with a clear reason', async () => {
  const uploads = sent.length;
  let error;
  try { await createVideoTask(config, { id: 'g1' }); } catch (e) { error = e; }
  assert.match(error?.message || '', /Continue turns the previous video into a first-frame image/);
  assert.equal(extractions.count, 0);
  assert.equal(sent.length, uploads);
});

test('8 images plus a Continue video of another ratio still extracts the frame and reaches the server', async () => {
  const eight = { ...config, referenceImages: config.referenceImages.slice(0, 8) };
  let error;
  try { await createVideoTask(eight, { id: 'g2' }); } catch (e) { error = e; }
  assert.doesNotMatch(error?.message || '', /Too many references|Continue turns/);
  assert.equal(extractions.count, 1);
  assert.equal(JSON.parse(sent.at(-1).body).imageUrls.length, 9);
});

test('the same 9 images with a 16:9 Continue video need no extracted frame and reach the server', async () => {
  globalThis.__w = 1920; globalThis.__h = 1080; sent.length = 0;
  let error;
  try { await createVideoTask(config, { id: 'g3' }); } catch (e) { error = e; }
  assert.doesNotMatch(error?.message || '', /Too many references|Continue turns/);
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].body).imageUrls.length, 9);
});

test('three Continue videos of another ratio stop before the third frame is extracted', async () => {
  globalThis.__w = 1080; globalThis.__h = 1920; sent.length = 0; extractions.count = 0;
  const three = { ...config, referenceImages: [], referenceVideos: ['v1', 'v2', 'v3'].map(id => ({ id, url: `https://cdn.example/${id}.mp4`, mimeType: 'video/mp4', duration: 5, isContinuation: true })) };
  let error;
  try { await createVideoTask(three, { id: 'g4' }); } catch (e) { error = e; }
  assert.match(error?.message || '', /Continue turns the previous video into a first-frame image/);
  assert.ok(extractions.count < 3, `extracted ${extractions.count} frames`);
  assert.equal(sent.length, 0);
});
