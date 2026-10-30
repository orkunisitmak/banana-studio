import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

const fixture = { rows: new Map() };
globalThis.__variationJobs = fixture;
const stubs = {
  providerRouting: 'export const selectProvider=async()=>"openai";',
  authService: 'export const supabase={}; export const getSession=async()=>({access_token:"synthetic",user:{id:"owner"}});',
  storageService: 'export const getImageById=async id=>globalThis.__variationJobs.rows.get(id); export const uploadBase64ToPublicUrl=async()=>{throw new Error("No references expected")}; export const refreshMediaAccessUrl=async url=>url;',
};
const pattern = new RegExp(`/(${Object.keys(stubs).join('|')})$`);
const bundle = await build({ entryPoints: ['src/services/openaiImageService.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'variation-backend', setup(b) {
  b.onResolve({ filter: pattern }, args => ({ path: args.path.match(pattern)[1], namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
} }] });
const { generateOpenAIImage } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
// Keep the actual App handler and the actual enqueue/deduplication/queue code.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const handleGenerateVariation = async');
const end = source.indexOf('  // The limit is checked', start);
const compiled = transformSync(`module.exports = env => {
  const { config, currentFolderId, toast, resolveImageModel, getImageById, resolveTextModelPreferences, generatePromptVariation,
    createPromptPreparation, DEFAULT_VIDEO_MODEL, SUNBURST_MODEL, getOpenAIImageOptions, getOpenAIImageSize,
    setGeneratedMedia, setActiveRequests, prepareProtectedImageSource, generateMedia, finishProtectedImageEdit,
    assertWorkspaceSession, saveImage, mergeSavedMedia, parseErrorMessage } = env;
  ${source.slice(start,end)}; return handleGenerateVariation;
};`, { loader: 'ts', format: 'cjs' }).code;
function setup(t, failPrompt) {
  fixture.rows = new Map(); let media = [], active = 0, toastId = 0;
  const requests = [], errors = [];
  // Privacy settings can coarsen the browser clock; two independent responses may also settle in one millisecond.
  t.mock.method(Date, 'now', () => 1793349000000);
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/openai-image-enqueue');
    const body = JSON.parse(init.body); requests.push(body);
    if (body.displayPrompt === failPrompt) return new Response(JSON.stringify({ error: 'Synthetic enqueue failure' }), { status: 400 });
    fixture.rows.set(body.id, { id: body.id, prompt: body.displayPrompt, url: `https://storage.invalid/${body.id}.png`, status: 'completed', mediaType: 'image', openaiStartedAt: Date.now() });
    return new Response(JSON.stringify({ id: body.id, durable: true }), { status: 202 });
  });
  const mod = { exports: {} }; new Function('module', compiled)(mod);
  const handler = mod.exports({ config: { imageModel: 'gpt-image-2.5-sunburst' }, currentFolderId: 'folder',
    toast: { loading: () => ++toastId, updateToast() {}, dismissToast() {}, success() {}, error: (...args) => errors.push(args) },
    resolveImageModel: value => value, getImageById: async () => assert.fail('No missing references'),
    resolveTextModelPreferences: async () => ({ model: 'gpt-6.1-sol' }), generatePromptVariation: async prompt => `Variation of ${prompt}`,
    createPromptPreparation: () => ({ kind: 'variation' }), DEFAULT_VIDEO_MODEL: 'seedance-2.5', SUNBURST_MODEL: 'gpt-image-2.5-sunburst',
    getOpenAIImageOptions: () => ({}), getOpenAIImageSize: () => '1024x1024',
    setGeneratedMedia: update => { media = update(media); }, setActiveRequests: update => { active = update(active); },
    prepareProtectedImageSource: async () => undefined,
    generateMedia: (config, progress, _created, context) => generateOpenAIImage(config, config.prompt, context, progress),
    finishProtectedImageEdit: async generated => generated, assertWorkspaceSession: async () => {},
    saveImage: async () => assert.fail('Durable worker results are already saved'), mergeSavedMedia: value => value,
    parseErrorMessage: error => ({ title: 'Generation failed', message: error.message }),
  });
  const original = prompt => ({ id: prompt, prompt, mediaType: 'image', aspectRatio: '1:1', resolution: '1K', imageModel: 'gpt-image-2.5-sunburst', referenceImages: [] });
  return { run: prompt => handler(original(prompt)), requests, errors, media: () => media, active: () => active };
}
test('concurrent variations sharing a clock tick enqueue distinct jobs and retain both results', async t => {
  const f = setup(t);
  await Promise.all([f.run('portrait'), f.run('landscape')]);
  assert.equal(f.requests.length, 2, 'different variations must not coalesce into one durable job');
  assert.equal(new Set(f.requests.map(request => request.id)).size, 2);
  assert.equal(new Set(f.media().map(media => media.id)).size, 2);
  assert.deepEqual(f.media().map(media => media.prompt).sort(), ['Variation of landscape', 'Variation of portrait']);
  assert.equal(f.active(), 0); assert.deepEqual(f.errors, []);
});
test('one failed concurrent variation leaves the other result intact and retry gets its own job', async t => {
  const f = setup(t, 'Variation of landscape');
  await Promise.all([f.run('portrait'), f.run('landscape')]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.media().filter(media => media.status === 'completed').length, 1);
  assert.equal(f.media().find(media => media.status === 'completed').prompt, 'Variation of portrait');
  assert.equal(f.media().filter(media => media.status === 'failed').length, 1);
  assert.equal(f.active(), 0);
  await f.run('retry');
  assert.equal(new Set(f.requests.map(request => request.id)).size, 3);
  assert.equal(f.media().filter(media => media.status === 'completed').length, 2);
  assert.equal(f.active(), 0);
});
