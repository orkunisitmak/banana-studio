import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// A Gallery video added to the composer keeps the 15-minute signed link it had
// when it was added. createVideoTask renews that link for the provider, but the
// Continue ratio check and last-frame extraction still load the old link, so a
// Continue started after the link expired fails with "Could not load reference video".
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
  // Renewal returns a fresh token for the same object, as the real storage service does.
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"https://cdn.example/frame.jpg";export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u.replace("token=expired","token=fresh");',
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

// An expired signed link fails to load like a 400 from storage; a fresh one loads.
const loaded = [];
globalThis.window = globalThis;
globalThis.document = { createElement: kind => kind === 'canvas'
  ? { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }
  : { videoWidth: globalThis.__w, videoHeight: globalThis.__h, duration: 5, removeAttribute() {}, load() {}, pause() {},
      set src(value) { if (!value) return; loaded.push(value); queueMicrotask(() => { value.includes('token=expired') ? this.onerror?.() : this.onloadedmetadata?.(); }); },
      set currentTime(_) { queueMicrotask(() => { this.onseeked?.(); }); } } };
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, body: init?.body }); return new Response(JSON.stringify({ error: 'stop here' }), { status: 400 }); };

const config = url => ({
  mode: 'video', prompt: 'Continue the shot', count: 1, imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K',
  videoModel: 'seedance-2.0', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: false,
  videoPromptExpansionMode: 'disabled', referenceImages: [], referenceAudios: [],
  referenceVideos: [{ id: 'v1', url, mimeType: 'video/mp4', duration: 5, isContinuation: true }],
});
const run = async url => {
  sent.length = 0; loaded.length = 0;
  let error;
  try { await createVideoTask(config(url), { id: 'g1' }); } catch (e) { error = e; }
  return error;
};

test('Continue from a Gallery video whose signed link expired still reaches the server (16:9 source, 16:9 target)', async () => {
  globalThis.__w = 1920; globalThis.__h = 1080;
  const error = await run('https://x.supabase.co/storage/v1/object/sign/media/u1/v1.mp4?token=expired');
  assert.doesNotMatch(error?.message || '', /Could not load reference video/);
  assert.equal(sent.length, 1, 'the video request was never sent');
  assert.deepEqual(loaded.filter(url => url.includes('token=expired')), [], 'the expired link was loaded after renewal');
});

test('Continue from an expired link with another ratio extracts the last frame from the renewed link (9:16 source, 16:9 target)', async () => {
  globalThis.__w = 1080; globalThis.__h = 1920;
  const error = await run('https://x.supabase.co/storage/v1/object/sign/media/u1/v1.mp4?token=expired');
  assert.doesNotMatch(error?.message || '', /Could not load reference video/);
  assert.equal(sent.length, 1, 'the video request was never sent');
});

test('control: the same Continue video with a live link reaches the server', async () => {
  globalThis.__w = 1920; globalThis.__h = 1080;
  const error = await run('https://x.supabase.co/storage/v1/object/sign/media/u1/v1.mp4?token=fresh');
  assert.doesNotMatch(error?.message || '', /Could not load reference video/);
  assert.equal(sent.length, 1);
});
