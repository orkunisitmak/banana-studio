import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// The desktop build swaps providerMedia for a local-file reader, which can fail before any provider call.
const stubs = {
  '/auth.js': 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>null;',
  '/providerMedia.js': 'export const isReferenceUrl=v=>typeof v==="string"&&v.startsWith("https://");export const providerImageUrl=async(_db,v)=>{if(globalThis.__referenceMissing)throw new Error("ENOENT: no such file or directory");return v;};',
  '/imageProviders.js': 'export const imageProviderModel=()=>"model";export const requestImage=async()=>{globalThis.__providerCalls++;return new Response(JSON.stringify({error:{code:"server_error"}}),{status:500});};',
};
const compiled = await build({entryPoints:['api/openai-image-generate.ts'],absWorkingDir:fileURLToPath(new URL('..',import.meta.url)),bundle:true,write:false,format:'esm',platform:'node',
  plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/_lib\/(auth|providerMedia|imageProviders)\.js$/},args=>({path:'/'+args.path.split('/').pop(),namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
    b.onResolve({filter:/^[^./]/},args=>({path:import.meta.resolve(args.path),external:true}));
  }}]});
const { executeOpenAIImage } = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));

const generate = async referenceMissing => {
  const warn = console.warn; console.warn = () => {};
  process.env.OPENAI_API_KEY = 'synthetic'; globalThis.__referenceMissing = referenceMissing; globalThis.__providerCalls = 0;
  const outcomes = [];
  const db = { from: () => ({ insert: async () => ({ error: null }), update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) };
  let body; const res = { setHeader() {}, status() { return this; }, json(value) { body = value; return this; }, end() { return this; } };
  try {
    await executeOpenAIImage({ method: 'POST', headers: {}, body: { id: 'gen1', model: 'gpt-image-2.5-sunburst', provider: 'openai', prompt: 'a red apple',
      aspectRatio: '1:1', resolution: '1K', referenceImages: [{ id: 'r1', data: 'https://media.example/r1.png', mimeType: 'image/png' }] } },
      res, { user: { id: 'u1' }, db, guard: { id: 'audit-1', async finish(outcome) { outcomes.push(outcome); } } });
  } finally { console.warn = warn; }
  return { ledger: outcomes[0], error: body?.error, providerCalls: globalThis.__providerCalls };
};

test('a reference that cannot be prepared is not recorded as a provider request', async () => {
  const result = await generate(true);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.ledger, 'rejected');
  assert.equal(result.error, 'A reference image could not be prepared. Attach it again. No image request was sent.');
});

test('a provider failure after dispatch is still recorded as failed', async () => {
  const result = await generate(false);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.ledger, 'failed');
});
