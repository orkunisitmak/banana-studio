import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// H3 Max Recast caps the prompt at 2,000 characters. @VIDEO and #IMAGE_1 expand into longer words
// ("the source video", "reference photo 1") before submit, so the composer check must count the expanded text.
const root = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(root + '/package.json');
const { build } = req('esbuild');

const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>(globalThis.__media++,"https://cdn.example/frame.jpg");export const uploadBlobToPublicUrl=async()=>(globalThis.__media++,"");export const uploadVideoBlobToPublicUrl=async()=>(globalThis.__media++,"");export const refreshMediaAccessUrl=async u=>(globalThis.__media++,u);',
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
const cfg = await build({ entryPoints: ['src/lib/video/h3MaxConfig.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
const cfgMod = { exports: {} };
new Function('module', 'exports', 'require', cfg.outputFiles[0].text)(cfgMod, cfgMod.exports, p => req(p));
const { getH3MaxConfigError } = cfgMod.exports;


globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ videoWidth: 1920, videoHeight: 1080, duration: 10, removeAttribute() {}, load() {}, pause() {},
  set src(_) { queueMicrotask(() => { this.onloadedmetadata?.(); }); } }) };
const sent = [];
globalThis.__media = 0; // every media upload or refresh the stubs see
globalThis.fetch = async (url, init) => { sent.push({ url, body: init?.body }); return new Response(JSON.stringify({ taskId: 't1' }), { status: 200 }); };

const base = {
  mode: 'video', count: 1, imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K',
  videoModel: 'minimax-h3', h3MaxMode: 'recast', videoOperation: 'generate', videoAspectRatio: 'adaptive', videoQuality: '1080p', videoDuration: -1, audioEnabled: false,
  referenceImages: [{ id: 'p1', data: 'https://cdn.example/p1.png', mimeType: 'image/png', width: 1024, height: 1024 }],
  referenceVideos: [{ id: 'v1', url: 'https://cdn.example/src.mp4', mimeType: 'video/mp4', duration: 10, width: 1920, height: 1080 }],
  referenceAudios: [],
};
const pad = (head, n) => head + 'x'.repeat(n - head.length);
const withTags = pad('Replace the lead with #IMAGE_1 in @VIDEO. ', 1990);   // 1,990 chars, 2 tags that expand
const plain = pad('Replace the lead with the new person in the clip. ', 1990); // 1,990 chars, no tags

test('a Recast prompt that is under 2,000 characters only before @VIDEO / #IMAGE_1 expand is rejected by the composer check, before any media is prepared', async () => {
  assert.equal(withTags.length, 1990);
  assert.match(getH3MaxConfigError({ ...base, prompt: withTags }) || '', /must not exceed/);
  sent.length = 0; globalThis.__media = 0;
  let error;
  try { await createVideoTask({ ...base, prompt: withTags }, { id: 'g1' }); } catch (e) { error = e; }
  assert.match(error?.message || '', /must not exceed/);
  assert.equal(sent.length, 0);
  assert.equal(globalThis.__media, 0, 'no media was prepared');
});

test('a tagged prompt that stays under 2,000 characters once expanded is accepted and submitted expanded', async () => {
  const short = pad('Replace the lead with #IMAGE_1 in @VIDEO. ', 1900);
  assert.equal(getH3MaxConfigError({ ...base, prompt: short }), null);
  sent.length = 0; globalThis.__media = 0;
  await createVideoTask({ ...base, prompt: short }, { id: 'g2' });
  assert.ok(globalThis.__media > 0, 'the counters see media preparation for a valid prompt');
  const prompt = JSON.parse(sent[0].body).prompt;
  assert.match(prompt, /^Replace the lead with reference photo 1 in the source video\./);
  assert.ok(prompt.length <= 2000);
});

test('the same length without tags reaches the server', async () => {
  sent.length = 0;
  let error;
  try { await createVideoTask({ ...base, prompt: plain }, { id: 'g3' }); } catch (e) { error = e; }
  assert.equal(error, undefined);
  assert.equal(sent.length, 1);
  assert.ok(JSON.parse(sent[0].body).prompt.length <= 2000);
});
