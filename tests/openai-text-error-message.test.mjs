import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Real api/openai-text-generate.ts handler. Only auth and the spend ledger are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({rpc:()=>({abortSignal:async()=>({data:{"gpt-6.2-sol":globalThis.gptRoute??"openai"}})}),from:()=>({insert:()=>({abortSignal:async()=>({error:null})})})});',
  openaiGuard: 'export const startOpenAIRequest=async()=>({id:"g1",finish:async()=>{}});export const startPaidRequest=startOpenAIRequest;export {openAIErrorMessage} from "./api/_lib/openaiError.ts";',
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
  test(`GPT-6.2 Sol text: upstream ${status} does not say an image was involved`, async () => {
    const res = await call('gpt-6.2-sol', status);
    assert.ok(res.body?.error, 'an error is returned');
    assert.doesNotMatch(res.body.error, /image/i, res.body.error);
  });
}

for (const [status, message] of [[503, /HTTP 503/], [429, /rate limited/]]) {
  test(`GPT-6.2 Sol text: a non-JSON upstream ${status} keeps its status and message`, async () => {
    globalThis.fetch = async () => new Response('<html>gateway error</html>', { status, headers: { 'content-type': 'text/html' } });
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, on() {}, off() {} };
    await handler({ method: 'POST', headers: {}, body: { model: 'gpt-6.2-sol', contents: { parts: [{ text: 'a brief' }] }, usageContext: { action: 'enhance', prompt: 'p' } } }, res);
    assert.equal(res.code, status);
    assert.match(res.body.error, message);
  });
}

test('EvoLink GPT uploads references before one Responses call and never substitutes OpenAI pricing', async t => {
  process.env.EVOLINK_API_KEY = 'fixture'; globalThis.gptRoute = 'evolink';
  t.after(() => { delete globalThis.gptRoute; delete process.env.EVOLINK_API_KEY; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(url);
    const body = JSON.parse(init.body);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture');
    if (calls.length === 1) {
      assert.equal(body.base64_data, 'data:image/png;base64,AAAA');
      return Response.json({ success: true, data: { file_url: 'https://example.invalid/temporary' } });
    }
    assert.equal(body.model, 'gpt-6.2-sol');
    assert.equal(body.store, false);
    assert.deepEqual(body.input[0].content.map(p => p.type), ['input_text', 'input_image']);
    assert.equal(body.input[0].content[1].image_url, 'https://example.invalid/temporary');
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Finished' }] }], usage: { input_tokens: 45, output_tokens: 120 } });
  });
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: {}, body: { model: 'gpt-6.2-sol', provider: 'evolink', contents: { parts: [{ text: 'Prompt' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] }, usageContext: { action: 'variation', prompt: 'Prompt' } } }, res);
  assert.deepEqual(calls, ['https://files-api.evolink.ai/api/v1/files/upload/base64', 'https://direct.evolink.ai/v1/responses']);
  assert.equal(res.code, 200);
  assert.equal(res.body.usageMetadata.textProvider, 'evolink');
  assert.equal(res.body.usageMetadata.providerCost, null);
});
