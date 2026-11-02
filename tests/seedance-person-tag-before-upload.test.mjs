import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nodeRoot = root;
const req = createRequire(root + 'package.json');
const { build } = req('esbuild');

const stubs = {
  '/authService': 'export const logUsage=()=>{};export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"t",user:{id:"u1"}}}})}};',
  '/storageService': 'export const uploadBase64ToPublicUrl=async()=>{globalThis.__uploads++;return "https://cdn.example/ref.jpg"};export const uploadBlobToPublicUrl=async()=>"";export const uploadVideoBlobToPublicUrl=async()=>"";export const refreshMediaAccessUrl=async u=>u;',
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
const route = await build({ entryPoints: ['./src/lib/video/seedanceProviders.ts'], absWorkingDir: root, bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent' });
const routeMod = { exports: {} };
new Function('module', 'exports', 'require', route.outputFiles[0].text)(routeMod, routeMod.exports, p => req(p));
const { seedanceProviderError } = routeMod.exports;

globalThis.window = globalThis; globalThis.__uploads = 0;
const sent = [];
globalThis.fetch = async (url, init) => { sent.push({ url, body: init?.body }); return new Response(JSON.stringify({ taskId: 't1' }), { status: 200 }); };

const config = (prompt, personId) => ({
  mode: 'video', prompt, count: 1, imageModel: 'gpt-image-2.5-sunburst', aspectRatio: '1:1', resolution: '1K',
  videoModel: 'seedance-2.0', videoOperation: 'generate', videoAspectRatio: '16:9', videoQuality: '720p', videoDuration: 5, audioEnabled: false,
  videoPromptExpansionMode: 'disabled',
  referenceImages: [{ id: 'a', data: 'data:image/png;base64,AAAA', mimeType: 'image/png', personId }],
  referenceVideos: [], referenceAudios: [],
});
const preflight = c => seedanceProviderError('evolink', { videoModel: c.videoModel, mode: 'reference_to_video', duration: c.videoDuration, quality: c.videoQuality,
  aspectRatio: c.videoAspectRatio, imageUrls: c.referenceImages.map(() => ''), videoUrls: [], audioUrls: [] });

test('a prompt tag for a person with no attached photo is rejected before any reference image is uploaded', async () => {
  sent.length = 0;
  const c = config('@PERSON_3 walks along the beach', 1);
  assert.equal(preflight(c), undefined, 'composer route check accepts it');
  globalThis.__uploads = 0;
  let error;
  try { await createVideoTask(c, { id: 'g1' }); } catch (e) { error = e; }
  assert.match(error?.message ?? '', /Person 3/);
  assert.equal(globalThis.__uploads, 0, 'no reference image is uploaded before the error');
  assert.equal(sent.length, 0);
});

test('control: the same tag for an attached person reaches the server', async () => {
  sent.length = 0;
  let error;
  try { await createVideoTask(config('@PERSON_1 walks along the beach', 1), { id: 'g2' }); } catch (e) { error = e; }
  assert.equal(error, undefined);
  assert.equal(sent.length, 1);
});
