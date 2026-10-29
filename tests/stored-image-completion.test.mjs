import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// One stored 1x1 PNG. The provider, auth and reference seams are stubbed.
const png = '89504e470d0a1a0a0000000d4948445200000001000000010806000000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082';
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>null;',
  providerMedia: 'export const isReferenceUrl=()=>true;export const providerImageUrl=async(_db,v)=>v;',
  imageProviders: `export const imageProviderModel=()=>"m";export const requestImage=async()=>new Response(JSON.stringify({data:[{b64_json:"${Buffer.from(png, 'hex').toString('base64')}"}],usage:{input_tokens_details:{text_tokens:1,image_tokens:0},output_tokens:1}}),{status:200});`,
};
// A relative entry with absWorkingDir: an absolute Windows entry (D:\\...) would match the package filter below.
const out = await build({ entryPoints: ['api/openai-image-generate.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /_lib\/(auth|providerMedia|imageProviders)\.js$/ }, args => ({ path: args.path.match(/(auth|providerMedia|imageProviders)\.js$/)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true });
  } }] });
const { executeOpenAIImage } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const run = async ({ signFails = false, auditFails = false }) => {
  process.env.OPENAI_API_KEY = 'synthetic';
  const row = {};
  const db = {
    from: () => { const q = { insert: async () => ({ error: null }), update: v => { q.value = v; return q; }, eq: () => q, then: (a, b) => { Object.assign(row, q.value); return Promise.resolve({ error: null }).then(a, b); } }; return q; },
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async path => signFails ? { data: null, error: { statusCode: '400', message: 'denied' } } : { data: { signedUrl: 'https://s/' + path }, error: null } }) },
  };
  const guard = { id: 'audit-1', async finish(outcome) { if (auditFails && outcome === 'completed') throw new Error('Audit could not be confirmed.'); } };
  let status = 0, body;
  const res = { setHeader() {}, status(value) { status = value; return this; }, json(value) { body = value; return this; }, end() { return this; } };
  const req = { method: 'POST', headers: {}, body: { id: 'gen1', model: 'gpt-image-2.5-sunburst', provider: 'openai', prompt: 'a red apple', aspectRatio: '1:1', resolution: '1K', referenceImages: [] } };
  await executeOpenAIImage(req, res, { user: { id: 'u1' }, db, guard, dispatch: async () => true }).catch(() => {});
  return { status, rowStatus: row.status, body };
};

test('a stored image stays completed when signing its URL fails afterwards', async () => {
  const { status, rowStatus, body } = await run({ signFails: true });
  assert.equal(status, 200);
  assert.equal(rowStatus, 'completed');
  assert.deepEqual({ id: body.id, url: body.url, storagePath: body.storagePath, referenceImages: body.referenceImages },
    { id: 'gen1', url: '', storagePath: 'openai/u1/gen1.png', referenceImages: [] });
  assert.equal(body.metadata.imageStoragePath, 'openai/u1/gen1.png');
});

test('a stored image stays completed when finishing its audit fails afterwards', async () => {
  assert.equal((await run({ auditFails: true })).rowStatus, 'completed');
  const control = await run({});
  assert.equal(control.status, 200);
  assert.equal(control.rowStatus, 'completed');
  assert.equal(control.body.url, 'https://s/openai/u1/gen1.png');
});
