import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { MODEL_ROUTES, resolveProvider } from '../src/lib/providers.ts';

// Auth, the spend ledger and usage logging are stubbed; upstream fetch is mocked. No network.
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({from:()=>({insert:row=>{globalThis.__usage.push(row);return {abortSignal:async()=>({error:null})};}})});',
  openaiGuard: 'export const startOpenAIRequest=async(req,res,user,kind,id,provider)=>{globalThis.__guards.push(provider);return {id:"g1",finish:async()=>{}};};',
  providerConfiguration: 'export const missingProviderMessage=(p,v)=>`${p} missing ${v}`;',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ stdin: { contents: "export * from './api/_lib/textProviders.ts'; export * from './api/_lib/chatCompletionsText.ts';", resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, args => ({ path: args.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    b.onResolve({ filter: /^[^./]/ }, args => args.path.startsWith('node:') ? undefined : { path: import.meta.resolve(args.path), external: true });
  } }] });
const { liquidTextProvider, openRouterTextProvider, createChatTextHandler } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const call = async (provider, body, upstream) => {
  const sent = []; globalThis.__usage = []; globalThis.__guards = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return upstream(); };
  let status = 200, payload;
  const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { payload = value; return this; }, end() { return this; } };
  await createChatTextHandler(provider)({ method: 'POST', headers: {}, body }, res);
  return { status, payload, sent, usage: globalThis.__usage, guards: globalThis.__guards };
};
const brainstorm = model => ({ model, reasoningEffort: 'medium', contents: { parts: [{ text: 'Write five distinct ideas.' }] }, usageContext: { action: 'brainstorm', prompt: 'p' }, brainstormCount: 5 });
const ideas = JSON.stringify({ ideas: { idea_1: 'a', idea_2: 'b', idea_3: 'c', idea_4: 'd', idea_5: 'e' } });
const liquidResponse = () => Response.json({ id: 'chatcmpl-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: ideas } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 }, exchange: { job_id: 'job_1', charge: { total_usd: 0.0123, cap_usd: 0.05 } } });

test('Liquid Inference is an opt-in text route that Auto never prefers over existing keys', () => {
  assert.deepEqual(MODEL_ROUTES['anthropic/claude-opus-5.5'], ['openrouter', 'liquid']);
  assert.deepEqual(MODEL_ROUTES['gemini-3.8-flash'], ['gemini', 'openrouter', 'liquid']);
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { liquid: true }), 'liquid');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { liquid: true, openrouter: true }), 'openrouter');
  assert.throws(() => resolveProvider('gpt-6.1-sol', 'liquid', { liquid: true }));
  assert.throws(() => resolveProvider('gemini-3-pro-image-preview', 'liquid', { liquid: true }));
});

test('Liquid Inference requests use exchange model ids, no OpenRouter routing block, and the exchange charge', async () => {
  process.env.LIQUID_API_KEY = 'synthetic-test-value';
  try {
    for (const [model, upstream] of [['anthropic/claude-opus-5.5', 'claude-opus-5-5'], ['gemini-3.8-flash', 'gemini-3.8-flash']]) {
      const result = await call(liquidTextProvider, brainstorm(model), liquidResponse);
      assert.equal(result.status, 200, JSON.stringify(result.payload));
      assert.equal(result.sent[0].url, 'https://router.inference.ai.exchange/v1/chat/completions');
      assert.equal(result.sent[0].headers.Authorization, 'Bearer synthetic-test-value');
      assert.equal(result.sent[0].body.model, upstream);
      assert.equal(result.sent[0].body.provider, undefined);
      assert.deepEqual(result.sent[0].body.reasoning, { effort: 'medium', exclude: true });
      assert.equal(result.sent[0].body.response_format.type, 'json_schema');
      assert.deepEqual(result.guards, ['Liquid Inference']);
      assert.equal(result.usage[0].estimated_cost, 0.0123);
      assert.equal(result.payload.provider, 'liquid');
      assert.equal(result.payload.usageMetadata.liquidUsage.charge.total_usd, 0.0123);
      assert.equal(JSON.parse(result.payload.text).length, 5);
    }
  } finally { delete process.env.LIQUID_API_KEY; }
});

test('Liquid Inference rejects YouTube footage and unlisted models before any paid request', async () => {
  process.env.LIQUID_API_KEY = 'synthetic-test-value';
  try {
    const footage = await call(liquidTextProvider, { model: 'gemini-3.8-flash', reasoningEffort: 'low', contents: { parts: [{ fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' } }, { text: 'Analyze.' }] }, usageContext: { action: 'enhance', prompt: 'p' }, outputFormat: 'youtube_analysis' }, liquidResponse);
    assert.equal(footage.status, 400); assert.equal(footage.sent.length, 0); assert.match(footage.payload.error, /Gemini or OpenRouter/);
    const unlisted = await call(liquidTextProvider, brainstorm('gpt-6.1-sol'), liquidResponse);
    assert.equal(unlisted.status, 400); assert.equal(unlisted.sent.length, 0);
    const notFound = await call(liquidTextProvider, brainstorm('anthropic/claude-opus-5.5'), () => Response.json({ error: { code: 'model_not_found' } }, { status: 404 }));
    assert.equal(notFound.status, 404); assert.match(notFound.payload.error, /another provider/);
  } finally { delete process.env.LIQUID_API_KEY; }
  const missing = await call(liquidTextProvider, brainstorm('anthropic/claude-opus-5.5'), liquidResponse);
  assert.equal(missing.status, 503); assert.equal(missing.sent.length, 0);
});

test('OpenRouter requests are unchanged by the shared handler', async () => {
  process.env.OPENROUTER_API_KEY = 'synthetic-test-value';
  try {
    const result = await call(openRouterTextProvider, brainstorm('gemini-3.8-flash'), () => Response.json({ id: 'gen-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: ideas } }], usage: { cost: 0.02 } }));
    assert.equal(result.status, 200);
    assert.equal(result.sent[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(result.sent[0].headers['X-OpenRouter-Title'], 'Banana Studio');
    assert.equal(result.sent[0].body.model, 'google/gemini-3.8-flash');
    assert.deepEqual(result.sent[0].body.provider, { require_parameters: true, allow_fallbacks: false, only: ['google-ai-studio'] });
    assert.deepEqual(result.guards, ['OpenRouter']);
    assert.equal(result.usage[0].estimated_cost, 0.02);
    assert.equal(result.payload.usageMetadata.openrouterUsage.cost, 0.02);
  } finally { delete process.env.OPENROUTER_API_KEY; }
});
