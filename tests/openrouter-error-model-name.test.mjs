import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real api/openrouter-text-generate.ts handler. Only auth and the spend ledger are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({from:()=>({insert:()=>({abortSignal:async()=>({error:null})})})});',
  openaiGuard: 'export const startOpenAIRequest=async()=>({id:"g1",finish:async()=>{}});',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ entryPoints: ['api/openrouter-text-generate.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, a => ({ path: a.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
  } }] });
const handler = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;

process.env.OPENROUTER_API_KEY = 'k';
const call = async (model, upstreamStatus) => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return new Response(JSON.stringify({ error: {} }), { status: upstreamStatus, headers: { 'content-type': 'application/json' } }); };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, on() {}, off() {} };
  await handler({ method: 'POST', headers: {}, body: { model, contents: { parts: [{ text: 'a brief' }] }, usageContext: { action: 'enhance', prompt: 'p' } } }, res);
  return { res, fetchCalls };
};

for (const model of ['gpt-6.1-sol', 'gemini-3.8-flash']) {
  for (const status of [429, 500]) {
    test(`${model} through OpenRouter: upstream ${status} does not blame Opus 5.5`, async () => {
      const { res, fetchCalls } = await call(model, status);
      assert.equal(fetchCalls, 1, 'the request reached OpenRouter');
      assert.equal(res.code, status);
      assert.ok(res.body?.error, 'an error is returned');
      assert.doesNotMatch(res.body.error, /Opus/, res.body.error);
    });
  }
}
