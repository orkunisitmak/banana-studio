import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: ['src/lib/images/imageReferences.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { imageReferenceError } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const refs = count => Array.from({ length: count }, () => ({ data: 'https://example.com/a.png' }));

test('Nano Banana names its limit of 14', () => {
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', refs(15)), 'Attach up to 14 valid reference images.');
  assert.equal(imageReferenceError('gemini-3-pro-image-preview', refs(16)), 'Attach up to 14 valid reference images.');
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', refs(14)), null);
});

test('GPT Image 2.5 names its limit of 16', () => {
  assert.equal(imageReferenceError('gpt-image-2.5-sunburst', refs(17)), 'Attach up to 16 valid reference images.');
  assert.equal(imageReferenceError('gpt-image-2.5-sunburst', refs(16)), null);
});

test('a reference without data is refused with the model limit', () => {
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', [{ data: '' }]), 'Attach up to 14 valid reference images.');
});

// The service entry point: 15 Nano Banana references are refused with the model's limit before any request is sent.
const stubs = {
  providerRouting: 'export const selectProvider=async()=>"openai";',
  authService: 'const s={access_token:"t",user:{id:"u1"}};export const supabase={};export const getSession=async()=>s;',
  storageService: 'export const getImageById=async()=>{throw new Error("unused")};export const uploadBase64ToPublicUrl=async()=>"p";export const refreshMediaAccessUrl=async v=>v;',
  referenceUploadCache: 'export const createReferenceUploader=()=>async()=>"path";',
  imagePrompting: 'export const validateImageGenerationReferences=()=>{};',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})$`);
const service = await build({ entryPoints: ['src/services/openaiImageService.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, args => ({ path: args.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true });
  } }] });
const { generateOpenAIImage } = await import('data:text/javascript;base64,' + Buffer.from(service.outputFiles[0].text).toString('base64'));
const serviceCall = async (imageModel, count) => {
  const requests = [];
  globalThis.fetch = async url => { requests.push(url); throw new Error('no request expected'); };
  const referenceImages = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, data: 'data:image/png;base64,AAAA', mimeType: 'image/png' }));
  const error = await generateOpenAIImage({ prompt: 'p', imageModel, aspectRatio: '1:1', resolution: '1K', referenceImages }, 'p').then(() => null, e => e);
  return { error, requests };
};

test('the service refuses 15 Nano Banana references with the limit of 14 and sends nothing', async () => {
  const { error, requests } = await serviceCall('gemini-nano-banana-2.1', 15);
  assert.equal(error?.message, 'Attach up to 14 valid reference images.');
  assert.deepEqual(requests, []);
});

test('the service refuses 17 GPT Image 2.5 references with the limit of 16 and sends nothing', async () => {
  const { error, requests } = await serviceCall('gpt-image-2.5-sunburst', 17);
  assert.equal(error?.message, 'Attach up to 16 valid reference images.');
  assert.deepEqual(requests, []);
});
