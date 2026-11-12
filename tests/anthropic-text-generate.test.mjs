import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { MODEL_ROUTES, resolveProvider } from '../src/lib/providers.ts';
import { calculateAnthropicTextCost } from '../src/lib/prompts/anthropicText.ts';

// Real api/anthropic-text-generate.ts handler and Anthropic SDK. Only auth, the spend ledger and fetch are stubbed.
const root = fileURLToPath(new URL('..', import.meta.url));
const stubs = {
  auth: 'export const applyCors=()=>{};export const requireUser=async()=>({id:"u1"});export const createUserScopedClient=()=>({from:()=>({insert:()=>({abortSignal:async()=>({error:null})})})});',
  openaiGuard: 'export const startOpenAIRequest=async()=>({id:"g1",finish:async()=>{}});',
};
const stubbed = new RegExp(`/(${Object.keys(stubs).join('|')})\\.js$`);
const out = await build({ entryPoints: ['api/anthropic-text-generate.ts'], absWorkingDir: root, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: stubbed }, a => ({ path: a.path.match(stubbed)[1], namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: stubs[a.path], loader: 'js' }));
  } }] });
const handler = (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;

const sse = (text, stopReason = 'end_turn') => {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 500 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  return new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } });
};
const call = async (body, reply) => {
  const requests = [];
  globalThis.fetch = async (input, init) => { requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(init.body) }); return reply(); };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; }, write() {}, on() {}, off() {} };
  await handler({ method: 'POST', headers: {}, body }, res);
  return { res, requests };
};
const brief = (extra = {}) => ({ model: 'anthropic/claude-opus-5.5', reasoningEffort: 'high', contents: { parts: [{ text: 'a brief' }] }, usageContext: { action: 'enhance', prompt: 'p' }, ...extra });

process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

test('Opus 5.5 is served directly by Anthropic first, OpenRouter second', () => {
  assert.deepEqual(MODEL_ROUTES['anthropic/claude-opus-5.5'], ['anthropic', 'openrouter']);
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { anthropic: true }), 'anthropic');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { openrouter: true }), 'openrouter');
  assert.throws(() => resolveProvider('gpt-6.1-sol', 'anthropic', { anthropic: true }));
});

test('sends text and images to the Messages API with effort, without a disabled thinking setting', async () => {
  const image = Buffer.from('png').toString('base64');
  const { res, requests } = await call(brief({ contents: { parts: [{ inlineData: { mimeType: 'image/png', data: image } }, { text: 'a brief' }] } }), () => sse('Finished prompt'));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.text, 'Finished prompt');
  assert.equal(res.body.provider, 'anthropic');
  assert.equal(requests.length, 1);
  const [{ url, headers, body }] = requests;
  assert.match(url, /\/v1\/messages/);
  assert.equal(headers.get('authorization'), 'Bearer sk-ant-test');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.stream, true);
  assert.equal(body.output_config.effort, 'high');
  assert.equal(body.output_config.format, undefined);
  assert.equal(body.thinking, undefined, 'Opus 5.5 rejects disabled thinking and budgets; effort controls depth');
  assert.equal(body.fallbacks, 'default');
  assert.deepEqual(body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } });
  assert.equal(res.body.usageMetadata.usageLogged, true);
});

test('Brainstorm requests a JSON schema and returns the normalized ideas', async () => {
  const ideas = JSON.stringify({ ideas: { idea_1: 'first idea', idea_2: 'second idea' } });
  const { res, requests } = await call(brief({ usageContext: { action: 'brainstorm', prompt: 'p' }, brainstormCount: 2 }), () => sse(ideas));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(JSON.parse(res.body.text), ['first idea', 'second idea']);
  const format = requests[0].body.output_config.format;
  assert.equal(format.type, 'json_schema');
  assert.deepEqual(format.schema.properties.ideas.required, ['idea_1', 'idea_2']);
  assert.equal(format.name, undefined, 'Anthropic json_schema takes only type and schema');
});

test('a refusal is reported, not shown as a prompt', async () => {
  const { res } = await call(brief(), () => sse('', 'refusal'));
  assert.equal(res.code, 422);
  assert.match(res.body.error, /yanıtlayamadı/);
});

for (const status of [401, 429, 529]) {
  test(`upstream ${status} is reported once and never retried`, async () => {
    const { res, requests } = await call(brief(), () => new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'x' } }), { status, headers: { 'content-type': 'application/json' } }));
    assert.equal(requests.length, 1);
    assert.equal(res.code, status);
    assert.match(res.body.error, status === 401 ? /Anthropic anahtarı/ : /yoğun/);
  });
}

test('YouTube footage and unsupported models never reach Anthropic', async () => {
  const youtube = await call(brief({ contents: { parts: [{ fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' } }, { text: 'x' }] } }), () => sse('x'));
  assert.equal(youtube.requests.length, 0); assert.equal(youtube.res.code, 400);
  const other = await call(brief({ model: 'gpt-6.1-sol' }), () => sse('x'));
  assert.equal(other.requests.length, 0); assert.equal(other.res.code, 400);
});

test('missing key fails before any request', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const { res, requests } = await call(brief(), () => sse('x'));
    assert.equal(res.code, 503); assert.equal(requests.length, 0);
  } finally { process.env.ANTHROPIC_API_KEY = 'sk-ant-test'; }
});

test('cost uses Opus 5.5 prices and is unknown when a fallback model served the turn', () => {
  assert.equal(calculateAnthropicTextCost({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, 'claude-opus-5-5'), 24);
  assert.equal(calculateAnthropicTextCost({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 }, 'claude-opus-5-5'), 5.2);
  assert.equal(calculateAnthropicTextCost({ input_tokens: 1, output_tokens: 1 }, 'claude-opus-5'), null);
});
