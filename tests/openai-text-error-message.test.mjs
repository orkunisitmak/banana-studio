import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real api/openai-text-generate.ts handler. Only auth and the spend ledger are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({from:()=>({insert:()=>({abortSignal:async()=>({error:null})})})});',
  openaiGuard: 'export const startOpenAIRequest=async()=>({id:"g1",finish:async()=>{}});export {openAIErrorMessage} from "./api/_lib/openaiError.ts";',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ entryPoints: ['api/openai-text-generate.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, a => ({ path: a.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js', resolveDir: root }));
  } }] });
const handler = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;

process.env.OPENAI_API_KEY = 'k';
const call = async (model, upstreamStatus) => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: {} }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } });
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, on() {}, off() {} };
  await handler({ method: 'POST', headers: {}, body: { model, contents: { parts: [{ text: 'a brief' }] }, usageContext: { action: 'enhance', prompt: 'p' } } }, res);
  return res;
};

for (const status of [500, 503]) {
  test(`GPT-6.1 Sol text: upstream ${status} does not say an image was involved`, async () => {
    const res = await call('gpt-6.1-sol', status);
    assert.ok(res.body?.error, 'an error is returned');
    assert.doesNotMatch(res.body.error, /image/i, res.body.error);
  });
}
