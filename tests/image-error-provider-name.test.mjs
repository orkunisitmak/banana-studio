import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Real api/openai-image-generate.ts handler and real openaiGuard.ts. Only auth/DB clients are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const { build } = createRequire(root + '/package.json')('esbuild');
const stubs = {
  auth: `export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});
export const createServiceRoleClient=()=>({rpc:()=>({abortSignal:async()=>({data:globalThis.__ledger,error:null})})});
export const createUserScopedClient=()=>({from:()=>({insert:async()=>({error:globalThis.__insertError||null})})});`,
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ entryPoints: ['api/openai-image-generate.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent', define: { 'import.meta.url': JSON.stringify('file://' + root + '/package.json') }, banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr('file://"+root+"/package.json');" },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, a => a.importer.includes('/api/') ? ({ path: a.path.match(stubbed)[1], namespace: 'stub' }) : undefined);
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
  } }] });
const handler = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;

for (const key of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'FAL_KEY']) process.env[key] = 'k';
process.env.VERCEL_ENV = 'production';
const jwt = 'h.' + Buffer.from(JSON.stringify({ session_id: '11111111-2222-3333-4444-555555555555' })).toString('base64url') + '.s';
const call = async (model, provider) => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: { id: 'g1', model, provider, prompt: 'a cat', aspectRatio: '1:1', resolution: '1K' } }, res);
  return res;
};
const cases = [
  ['gemini-nano-banana-2.1', 'gemini', 'Google Gemini'],
  ['gemini-nano-banana-2.1', 'openrouter', 'OpenRouter'],
  ['gemini-nano-banana-2.1', 'fal', 'fal.ai'],
  ['gpt-image-2.5-sunburst', 'openai', 'OpenAI'],
];

for (const [model, provider, label] of cases) {
  test(`${provider} image: a rate-limited request names ${label}`, async () => {
    globalThis.__ledger = { allowed: false, reason: 'rate', retry_after: 30 };
    const res = await call(model, provider);
    assert.equal(res.code, 429);
    assert.equal(res.body.error, `${label} request limit reached. Wait before trying again.`);
  });

  test(`${provider} image: a failed saved-row insert names ${label}`, async () => {
    globalThis.__ledger = { allowed: true };
    globalThis.__insertError = { code: '500' };
    const res = await call(model, provider);
    assert.equal(res.code, 500);
    assert.equal(res.body.error, `Could not create the saved generation. No ${label} request was sent.`);
  });
}
