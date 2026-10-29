import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { MODEL_ROUTES, resolveProvider } from '../src/lib/providers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// src/lib modules use bundler-style .js specifiers; esbuild resolves them to the .ts sources.
const bundle = async contents => {
  const file = fileURLToPath(new URL('./.temp-local-models.mjs', import.meta.url));
  await build({ stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, outfile: file, format: 'esm', platform: 'node', packages: 'external' });
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
};
const lib = await bundle(`export * from './src/lib/localModels.ts'; export * from './api/_lib/localMedia.ts';
  export { requestImage } from './api/_lib/imageProviders.ts'; export { diffPrompts } from './src/lib/prompts/promptDiff.ts';
  export { buildOpenAICompatibleChat, isVisionUnsupported, openAICompatibleErrorMessage } from './src/lib/prompts/ollamaText.ts'; export { editMaskPNG } from './api/_lib/protectedImageEdit.ts';
  export { decodeRaster } from './api/_lib/rasterCodec.ts'; export { buildGalleryUpscaleConfig } from './src/components/galleryImageEdit.ts';`);
const { selectJobs } = await import('../desktop/server/scheduler.mjs');

const fixture = `export const applyCors=()=>{}; export const requireUser=async()=>({id:"synthetic-user"});
  export const createServiceRoleClient=()=>({}); export const prepareTaskRegistry=async()=>({});
  export const registerProviderTask=async(_w,provider,taskId,userId)=>{globalThis.__tasks.push({provider,taskId,userId});};
  export const requireProviderTask=async(_req,res,provider,taskId)=>{if(!globalThis.__tasks.some(t=>t.provider===provider&&t.taskId===taskId)){res.status(404).json({error:'Task not found'});return false;}return true;};
  export const signedMediaUrl=async(_b,p)=>'https://storage.invalid/'+p;
  export const createUserScopedClient=()=>({storage:{from:()=>({createSignedUrl:async()=>({error:{message:'missing'}}),upload:async(p,bytes)=>{globalThis.__uploads.push({p,size:bytes.length});return {error:null};}})}});`;
const videoFile = fileURLToPath(new URL('./.temp-local-video.mjs', import.meta.url));
await build({ entryPoints: [path.join(root, 'api/local-video.ts')], bundle: true, outfile: videoFile, format: 'esm', platform: 'node', packages: 'external',
  plugins: [{ name: 'fixtures', setup(b) {
    b.onResolve({ filter: /\/(auth|providerTasks|imageStorage)\.js$/ }, () => ({ path: 'fixture', namespace: 'fx' }));
    b.onLoad({ filter: /.*/, namespace: 'fx' }, () => ({ contents: fixture }));
  } }] });
const { default: videoHandler } = await import(pathToFileURL(videoFile).href);
fs.rmSync(videoFile, { force: true });

const response = () => ({ statusCode: 200, body: undefined, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });
const withEnv = async (env, fetchImpl, run) => {
  const saved = { ...process.env }, original = globalThis.fetch;
  Object.assign(process.env, env); globalThis.fetch = fetchImpl;
  try { await run(); } finally { process.env = saved; globalThis.fetch = original; }
};
import sharp from 'sharp';
const sharpPng = (width, height) => sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Minimal ComfyUI double: queue, history, view, upload and checkpoint listing. */
const comfy = (outputs, calls = []) => async (url, init = {}) => {
  const u = new URL(url); calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), init });
  if (u.pathname === '/object_info/CheckpointLoaderSimple') return Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sd_turbo.safetensors']] } } } });
  if (u.pathname === '/upload/image') return Response.json({ name: 'banana-ref.png', subfolder: '', type: 'input' });
  if (u.pathname === '/prompt') return Response.json({ prompt_id: '0b9c1a52-0000-4000-8000-000000000001' });
  if (u.pathname.startsWith('/history/')) return Response.json({ '0b9c1a52-0000-4000-8000-000000000001': { status: { status_str: 'success', completed: true }, outputs } });
  if (u.pathname === '/view') return new Response(PNG, { status: 200 });
  if (u.pathname === '/system_stats' || u.pathname === '/api/version') return Response.json({});
  return new Response('not found', { status: 404 });
};

test('local routes: image picks SD WebUI then ComfyUI, video needs ComfyUI, text falls back only in Auto', () => {
  assert.deepEqual(MODEL_ROUTES['local-image'], ['sdwebui', 'comfyui']);
  assert.equal(resolveProvider('local-image', 'auto', { comfyui: true }), 'comfyui');
  assert.throws(() => resolveProvider('local-video', 'auto', { fal: true }), /COMFYUI_BASE_URL/);
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { ollama: true }), 'ollama');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { ollama: true, openrouter: true }), 'openrouter');
  assert.throws(() => resolveProvider('gpt-6.1-sol', 'auto', {}), /key/);
});

test('server addresses, names and canvas sizes', () => {
  assert.equal(lib.localServerUrl('comfyui', { BANANA_RUNTIME: 'local' }), 'http://127.0.0.1:8188');
  assert.equal(lib.localServerUrl('sdwebui', {}), null);
  assert.equal(lib.localServerUrl('sdwebui', { SDWEBUI_BASE_URL: 'http://gpu.lan:7860/', SDWEBUI_ENABLED: 'false' }), null);
  assert.equal(lib.localServerUrl('openaicompat', { LOCAL_OPENAI_BASE_URL: 'http://127.0.0.1:1234/v1/' }), 'http://127.0.0.1:1234/v1');
  for (const bad of ['../x.json', 'a/b.json', 'x.txt', '.hidden.json']) assert.equal(lib.isWorkflowName(bad), false, bad);
  assert.equal(lib.isWorkflowName('wan 2.2 i2v.json'), true);
  assert.equal(lib.isLocalAssetName('v1-5-pruned-emaonly.safetensors [6ce0161689]'), true);
  assert.equal(lib.isLocalAssetName('bad\nname'), false);
  const wide = lib.localImageSize('16:9', '1K');
  assert.ok(wide.width % 8 === 0 && wide.height % 8 === 0 && Math.abs(wide.width / wide.height - 16 / 9) < 0.01);
  const odd = lib.localImageSize('1:1', '1K', { width: 1001, height: 601 });
  assert.ok(odd.width % 8 === 0 && odd.height % 8 === 0 && Math.abs(odd.width / odd.height - 1001 / 601) / (1001 / 601) <= 0.01, JSON.stringify(odd));
  assert.deepEqual(lib.localImageSize('1:1', '1K', { width: 1200, height: 800 }), { width: 1200, height: 800 });
  assert.deepEqual(lib.localVideoSize('9:16', '720p'), { width: 720, height: 1280 });
  assert.deepEqual(lib.localVideoSize('adaptive', 'bogus'), { width: 848, height: 480 });
});

test('workflow placeholders keep their types and never build JSON from text', () => {
  const filled = lib.fillWorkflow({ a: { inputs: { w: '{{width}}', text: 'photo of {{prompt}}', seed: '{{seed}}', keep: '{{unknown}}', link: ['4', 1] } } },
    { width: 512, prompt: 'a "cat"}', seed: 7 });
  assert.deepEqual(filled.a.inputs, { w: 512, text: 'photo of a "cat"}', seed: 7, keep: '{{unknown}}', link: ['4', 1] });
  const graph = lib.defaultComfyImageWorkflow(true);
  assert.equal(graph[10].class_type, 'LoadImage');
  assert.deepEqual(graph[5].inputs.pixels, ['12', 0]);
  assert.equal(lib.workflowUses(lib.defaultComfyImageWorkflow(false), 'image'), false);
});

test('workflow folder: API-format files only, UI exports rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-workflows-'));
  try {
    fs.writeFileSync(path.join(dir, 'flux.json'), JSON.stringify({ 1: { class_type: 'X', inputs: { text: '{{prompt}}' } } }));
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify({ nodes: [], links: [] }));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
    process.env.COMFYUI_WORKFLOWS_DIR = dir;
    assert.deepEqual(lib.listWorkflows(), ['flux.json', 'ui.json']);
    assert.equal(lib.readWorkflow('flux.json')[1].class_type, 'X');
    assert.throws(() => lib.readWorkflow('ui.json'), /API Format/);
    assert.throws(() => lib.readWorkflow('../flux.json'), /workflows folder/);
  } finally { delete process.env.COMFYUI_WORKFLOWS_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('SD WebUI: txt2img with checkpoint override, img2img with the edit source', async () => {
  const calls = [];
  await withEnv({ SDWEBUI_BASE_URL: 'http://sd.invalid:7860' }, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ images: [PNG.toString('base64')] });
  }, async () => {
    const txt = await lib.requestImage('sdwebui', 'local-image', { prompt: 'long app prompt', localPrompt: 'a red fox', aspect_ratio: '1:1', resolution: '1K', localModel: 'sdxl.safetensors' }, null, '', 'audit');
    const data = await txt.json();
    assert.equal(data.data[0].b64_json, PNG.toString('base64'));
    assert.equal(data.usage.cost, 0);
    assert.equal(calls[0].url, 'http://sd.invalid:7860/sdapi/v1/txt2img');
    assert.equal(calls[0].body.prompt, 'a red fox');
    assert.deepEqual([calls[0].body.width, calls[0].body.height], [1024, 1024]);
    assert.equal(calls[0].body.override_settings.sd_model_checkpoint, 'sdxl.safetensors');
    await lib.requestImage('sdwebui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K', localInit: 1, localSource: { width: 640, height: 480 },
      images: [{ image_url: 'data:image/png;base64,AAAA' }, { image_url: `data:image/png;base64,${PNG.toString('base64')}` }] }, null, '', 'audit');
    assert.equal(calls[1].url, 'http://sd.invalid:7860/sdapi/v1/img2img');
    assert.equal(calls[1].body.init_images[0], PNG.toString('base64'));
    assert.deepEqual([calls[1].body.width, calls[1].body.height], [640, 480]);
  });
});

test('ComfyUI image: default graph, first installed checkpoint, saved output preferred over preview', async () => {
  const calls = [];
  await withEnv({ COMFYUI_BASE_URL: 'http://comfy.invalid:8188' }, comfy({
    9: { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }, { filename: 'banana-studio_00001_.png', subfolder: '', type: 'output' }] },
  }, calls), async () => {
    const result = await (await lib.requestImage('comfyui', 'local-image', { prompt: 'x', localPrompt: 'a lighthouse', aspect_ratio: '16:9', resolution: '1K' }, null, '', 'audit')).json();
    assert.equal(Buffer.from(result.data[0].b64_json, 'base64').equals(PNG), true);
    const queued = JSON.parse(calls.find(call => call.path === '/prompt').init.body).prompt;
    assert.equal(queued[4].inputs.ckpt_name, 'sd_turbo.safetensors');
    assert.equal(queued[6].inputs.text, 'a lighthouse');
    assert.equal(typeof queued[5].inputs.width, 'number');
    assert.deepEqual(calls.find(call => call.path === '/view').query, { filename: 'banana-studio_00001_.png', subfolder: '', type: 'output' });
  });
});

test('ComfyUI failures surface a clear message', async () => {
  await withEnv({ COMFYUI_BASE_URL: 'http://comfy.invalid:8188' }, async url => {
    const u = new URL(url);
    if (u.pathname === '/prompt') return Response.json({ prompt_id: 'abc' });
    if (u.pathname.startsWith('/history/')) return Response.json({ abc: { status: { status_str: 'error', completed: false }, outputs: {} } });
    return Response.json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors']] } } } });
  }, async () => {
    await assert.rejects(lib.requestImage('comfyui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K' }, null, '', 'audit'), /failing node/);
  });
});

test('local video: needs a workflow, registers an owned task, polls and saves the file', async () => {
  globalThis.__tasks = []; globalThis.__uploads = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banana-video-workflows-'));
  fs.writeFileSync(path.join(dir, 'ltx.json'), JSON.stringify({ 1: { class_type: 'T', inputs: { text: '{{prompt}}', frames: '{{frames}}', fps: '{{fps}}', w: '{{width}}' } },
    2: { class_type: 'SaveVideo', inputs: { video: ['1', 0] } } }));
  const calls = [];
  try {
    await withEnv({ COMFYUI_BASE_URL: 'http://comfy.invalid:8188', COMFYUI_WORKFLOWS_DIR: dir, BANANA_RUNTIME: '' }, comfy({
      2: { videos: [{ filename: 'clip.mp4', subfolder: 'video', type: 'output' }], images: [{ filename: 'thumb.png', type: 'output' }] },
    }, calls), async () => {
      let res = response();
      await videoHandler({ method: 'POST', headers: {}, query: {}, body: { videoModel: 'local-video', prompt: 'waves', duration: 5, quality: '480p', aspectRatio: '16:9' } }, res);
      assert.equal(res.statusCode, 400);
      assert.match(res.body.error, /video workflow/);
      res = response();
      await videoHandler({ method: 'POST', headers: {}, query: {}, body: { videoModel: 'local-video', prompt: 'waves', duration: 5, quality: '480p', aspectRatio: '16:9', localWorkflow: 'ltx.json' } }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.taskId, 'bs_comfyui_local-video_0b9c1a52-0000-4000-8000-000000000001');
      assert.deepEqual(globalThis.__tasks[0], { provider: 'comfyui', taskId: res.body.taskId, userId: 'synthetic-user' });
      const graph = JSON.parse(calls.find(call => call.path === '/prompt').init.body).prompt;
      assert.deepEqual(graph[1].inputs, { text: 'waves', frames: 81, fps: 16, w: 848 });
      const poll = response();
      await videoHandler({ method: 'GET', headers: {}, query: { taskId: res.body.taskId }, body: undefined }, poll);
      assert.equal(poll.body.status, 'SUCCEEDED', JSON.stringify(poll.body));
      assert.equal(poll.body.output[0], 'https://storage.invalid/synthetic-user/local-video/0b9c1a52-0000-4000-8000-000000000001.mp4');
      assert.equal(poll.body.actualCostUsd, 0);
      assert.deepEqual(calls.findLast(call => call.path === '/view').query, { filename: 'clip.mp4', subfolder: 'video', type: 'output' });
      assert.equal(globalThis.__uploads[0].p, 'synthetic-user/local-video/0b9c1a52-0000-4000-8000-000000000001.mp4');
      const foreign = response();
      await videoHandler({ method: 'GET', headers: {}, query: { taskId: 'bs_comfyui_local-video_someone-else' }, body: undefined }, foreign);
      assert.equal(foreign.statusCode, 404);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('OpenAI-compatible chat uses content parts and json_schema without $ref', () => {
  const chat = lib.buildOpenAICompatibleChat({ model: 'qwen2.5-7b-instruct', system: 'S', parts: [{ text: 'A' }, { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }],
    schema: { type: 'object', $defs: { i: { type: 'string' } }, properties: { x: { $ref: '#/$defs/i' } } } }, 'ideas');
  assert.deepEqual(chat.messages[1].content, [{ type: 'text', text: 'A' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }]);
  assert.deepEqual(chat.response_format.json_schema.schema, { type: 'object', properties: { x: { type: 'string' } } });
  assert.equal(chat.response_format.json_schema.name, 'ideas');
});

test('Enhance diff marks added and removed words', () => {
  const parts = lib.diffPrompts('a cat on a sofa', 'a fluffy cat on a red sofa');
  assert.equal(parts.filter(part => part.type === 'removed').length, 0);
  assert.equal(parts.filter(part => part.type === 'added').map(part => part.text.trim()).join('|'), 'fluffy|red');
  assert.equal(parts.map(part => part.text).join(''), 'a fluffy cat on a red sofa');
  assert.deepEqual(lib.diffPrompts('same', 'same'), [{ type: 'same', text: 'same' }]);
  const long = lib.diffPrompts('x '.repeat(2000), 'y');
  assert.deepEqual(long.map(part => part.type), ['removed', 'added']);
});

test('desktop queue runs one local GPU job at a time next to cloud jobs', () => {
  const job = (id, provider, extra = {}) => ({ id, payload: { provider }, ...extra });
  const pending = [job('a', 'comfyui'), job('b', 'sdwebui'), job('c', 'openai'), job('d', 'fal')];
  assert.deepEqual(selectJobs(pending, new Map()).map(j => j.id), ['a', 'c']);
  assert.deepEqual(selectJobs(pending, new Map([['a', pending[0]]])).map(j => j.id), ['c']);
  assert.deepEqual(selectJobs([job('x', 'openai'), job('y', 'openrouter')], new Map()).map(j => j.id), ['x', 'y']);
  assert.deepEqual(selectJobs([job('w', 'comfyui', { retryAt: Date.now() + 60_000 }), job('z', 'sdwebui')], new Map()).map(j => j.id), ['z']);
});

test('local image options are validated on the server', () => {
  const base = { model: 'local-image' };
  assert.equal(lib.localImageOptionsError({ ...base, localSeed: 42, localNegativePrompt: 'blurry', localUpscale: 4 }), null);
  for (const bad of [{ localSeed: -1 }, { localSeed: 2 ** 32 }, { localSeed: 1.5 }, { localNegativePrompt: 'x'.repeat(2001) }, { localUpscale: 3 }, { localWorkflow: '../a.json' }]) {
    assert.ok(lib.localImageOptionsError({ ...base, ...bad }), JSON.stringify(bad));
  }
  assert.match(lib.localImageOptionsError({ model: 'gpt-image-2.5-sunburst', localSeed: 1 }), /local image model/);
});

test('SD WebUI receives the seed, negative prompt and a real inpaint mask for area edits', async () => {
  const calls = [];
  const source = await sharpPng(64, 48);
  await withEnv({ SDWEBUI_BASE_URL: 'http://sd.invalid:7860' }, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ images: [PNG.toString('base64')] });
  }, async () => {
    await lib.requestImage('sdwebui', 'local-image', { prompt: 'x', localPrompt: 'blue shirt', aspect_ratio: '4:3', resolution: '1K', localSeed: 1234, localNegative: 'watermark',
      localSource: { width: 64, height: 48 }, localMaskRegion: { x: 0.5, y: 0, width: 0.5, height: 1 },
      images: [{ image_url: `data:image/png;base64,${source.toString('base64')}` }] }, null, '', 'audit');
    const body = calls[0].body;
    assert.equal(calls[0].url, 'http://sd.invalid:7860/sdapi/v1/img2img');
    assert.equal(body.seed, 1234);
    assert.equal(body.negative_prompt, 'watermark');
    assert.equal(body.inpainting_fill, 1);
    assert.equal(body.denoising_strength, 0.75);
    const mask = await lib.decodeRaster(Buffer.from(body.mask, 'base64'));
    assert.deepEqual([mask.info.width, mask.info.height], [64, 48]);
    const at = (x, y) => mask.data[(y * 64 + x) * mask.info.channels];
    assert.equal(at(5, 24), 0, 'left half is kept');
    assert.equal(at(60, 24), 255, 'right half is repainted');
  });
});

test('ComfyUI area edit uploads the mask and uses a latent noise mask', async () => {
  const calls = [];
  const source = await sharpPng(64, 64);
  await withEnv({ COMFYUI_BASE_URL: 'http://comfy.invalid:8188' }, comfy({ 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } }, calls), async () => {
    await lib.requestImage('comfyui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K', localSeed: 7,
      localSource: { width: 64, height: 64 }, localMaskRegion: { x: 0, y: 0, width: 0.5, height: 0.5 },
      images: [{ image_url: `data:image/png;base64,${source.toString('base64')}` }] }, null, '', 'audit');
    assert.equal(calls.filter(call => call.path === '/upload/image').length, 2);
    const graph = JSON.parse(calls.find(call => call.path === '/prompt').init.body).prompt;
    assert.equal(graph[5].class_type, 'SetLatentNoiseMask');
    assert.equal(graph[14].inputs.image, 'banana-ref.png');
    assert.equal(graph[3].inputs.seed, 7);
    assert.equal(graph[3].inputs.denoise, 0.75);
  });
});

test('upscale: SD WebUI extras endpoint, ComfyUI model graph, oversized output rejected', async () => {
  const source = await sharpPng(100, 50);
  const images = [{ image_url: `data:image/png;base64,${source.toString('base64')}` }];
  const calls = [];
  await withEnv({ SDWEBUI_BASE_URL: 'http://sd.invalid:7860', LOCAL_UPSCALER: '' }, async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ image: PNG.toString('base64') });
  }, async () => {
    await lib.requestImage('sdwebui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K', localUpscale: 4, images }, null, '', 'audit');
    assert.equal(calls[0].url, 'http://sd.invalid:7860/sdapi/v1/extra-single-image');
    assert.equal(calls[0].body.upscaling_resize, 4);
    assert.equal(calls[0].body.upscaler_1, 'R-ESRGAN 4x+');
  });
  const comfyCalls = [];
  const double = comfy({ 5: { images: [{ filename: 'up.png', subfolder: '', type: 'output' }] } }, comfyCalls);
  await withEnv({ COMFYUI_BASE_URL: 'http://comfy.invalid:8188' }, async (url, init) => new URL(url).pathname === '/object_info/UpscaleModelLoader'
    ? Response.json({ UpscaleModelLoader: { input: { required: { model_name: [['4x-UltraSharp.pth']] } } } }) : double(url, init), async () => {
    await lib.requestImage('comfyui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K', localUpscale: 2, images }, null, '', 'audit');
    const graph = JSON.parse(comfyCalls.find(call => call.path === '/prompt').init.body).prompt;
    assert.equal(graph[2].inputs.model_name, '4x-UltraSharp.pth');
    assert.deepEqual([graph[4].inputs.width, graph[4].inputs.height], [200, 100]);
  });
  const huge = await sharpPng(4000, 3000);
  await assert.rejects(lib.requestImage('sdwebui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K', localUpscale: 4,
    images: [{ image_url: `data:image/png;base64,${huge.toString('base64')}` }] }, null, '', 'audit'), /too large/);
});

test('gallery upscale reuses the image as a plain reference on the local model', () => {
  const config = lib.buildGalleryUpscaleConfig({ id: 'abc', url: 'https://x.invalid/a.png', prompt: 'cat', aspectRatio: '16:9', resolution: '2K' }, 4);
  assert.equal(config.imageModel, 'local-image');
  assert.equal(config.localUpscale, 4);
  assert.deepEqual(config.referenceImages, [{ id: 'gallery-abc', data: 'https://x.invalid/a.png', mimeType: 'image/png' }]);
  assert.equal(config.count, 1);
});

test('local server error bodies never reach the user, only the status', async () => {
  await withEnv({ SDWEBUI_BASE_URL: 'http://sd.invalid:7860' }, async () =>
    Response.json({ error: 'Traceback: internal-secret-detail in private.safetensors' }, { status: 500 }), async () => {
    const error = await lib.requestImage('sdwebui', 'local-image', { prompt: 'x', aspect_ratio: '1:1', resolution: '1K' }, null, '', 'audit').catch(failure => failure);
    assert.match(error.message, /rejected the request \(500\)/);
    assert.doesNotMatch(error.message, /internal-secret-detail|Traceback|safetensors/);
  });
});

test('only explicit "no image support" errors suggest a vision model', () => {
  for (const detail of ['model does not support images', "This model doesn't support image input", 'Vision is not supported by this model', 'this model is missing data required for image input']) {
    assert.equal(lib.isVisionUnsupported(detail), true, detail);
  }
  for (const detail of ['image is too large', 'failed to decode image', 'Image exceeds 20MB', undefined]) assert.equal(lib.isVisionUnsupported(detail), false, String(detail));
  assert.match(lib.openAICompatibleErrorMessage(400, 'image is too large'), /rejected this request/);
});
