import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Paid step before cheap validation. Seedance 2.5 Video Edit with a large (4K) source runs the paid fal.ai
// /api/fal-video-scale job inside prepareReferenceVideos. Reference audio is resolved only AFTER that, so an audio
// clip that is over 15 MB (checked nowhere at attach or in preflight) fails after the scale job was already billed.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + 'package.json');
const { build } = req('esbuild');

const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>"https://cdn.example/ref.jpg";export const uploadBlobToPublicUrl=async()=>"https://cdn.example/a.mp3";export const uploadVideoBlobToPublicUrl=async()=>"https://cdn.example/v.mp4";export const refreshMediaAccessUrl=async u=>u;',
  '/providerRouting': 'export const selectProvider=async()=>"evolink";',
};
const compiled = await build({ entryPoints: ['./src/services/runwayService.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  define: { 'import.meta.url': '"file:///x/"', 'import.meta.env': '{"VITE_X":""}' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(stub => args.path.endsWith(stub)); return key ? { path: key, namespace: 'stub' } : undefined; });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => ({ path: req.resolve(args.path), external: true }));
  } }] });
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(mod, mod.exports, p => req(p));
const { createVideoTask } = mod.exports;

globalThis.window = globalThis;
globalThis.document = { createElement: () => { const el = { duration: 10, videoWidth: 3840, videoHeight: 2160, removeAttribute() {}, load() {}, pause() {},
  set src(_) { queueMicrotask(() => el.onloadedmetadata?.()); } }; return el; } };
let scaleSubmits = 0; const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('blob:')) return new Response(new Blob([new Uint8Array(16 * 1024 * 1024 + 1)], { type: 'audio/mpeg' }), { status: 200 });
  if (String(url).includes('/api/fal-video-scale') && init?.method === 'POST') { scaleSubmits++; return new Response(JSON.stringify({ error: 'stop' }), { status: 500 }); }
  sent.push(url); return new Response(JSON.stringify({ taskId: 't1' }), { status: 200 });
};

const config = audioUrl => ({
  mode: 'video', prompt: 'Make the sky stormy', count: 1, imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K',
  videoModel: 'seedance-2.5', videoOperation: 'edit', videoAspectRatio: 'adaptive', videoQuality: '720p', videoDuration: -1, audioEnabled: false,
  videoPromptExpansionMode: 'disabled', referenceImages: [],
  referenceVideos: [{ id: 'v1', url: 'https://cdn.example/src.mp4', mimeType: 'video/mp4', duration: 10, width: 3840, height: 2160 }],
  referenceAudios: audioUrl ? [{ id: 'a1', url: audioUrl, mimeType: 'audio/mpeg', duration: 10 }] : [],
});

test('an over-size reference audio is rejected before the paid source-video scale job is submitted', async () => {
  scaleSubmits = 0;
  let error;
  try { await createVideoTask(config('blob:audio'), { id: 'g1' }); } catch (e) { error = e; }
  assert.match(error?.message ?? '', /reference audio 1/);
  assert.equal(scaleSubmits, 0, 'no paid scale job is submitted');
});

test('control: the same Edit without audio does submit the scale job', async () => {
  scaleSubmits = 0;
  try { await createVideoTask(config(null), { id: 'g2' }); } catch {}
  assert.equal(scaleSubmits, 1);
});
