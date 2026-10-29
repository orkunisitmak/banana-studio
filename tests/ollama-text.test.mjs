import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { MODEL_ROUTES, resolveProvider } from '../src/lib/providers.ts';

// src/lib modules use bundler-style .js specifiers; esbuild resolves them to the .ts sources.
const helpers = await build({ stdin: { contents: `export * from './src/lib/prompts/ollamaText.ts'; export { buildBrainstormOutputFormat } from './api/_lib/textOutputFormats.ts';`,
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildOllamaChat, buildOpenAICompatibleChat, inlineSchemaRefs, isOllamaModelName, ollamaBaseUrl, ollamaContextSize, buildBrainstormOutputFormat } =
  await import('data:text/javascript;base64,' + Buffer.from(helpers.outputFiles[0].text).toString('base64'));
const tempFile = fileURLToPath(new URL('./.temp-ollama-text.mjs', import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL('../api/ollama-text-generate.ts', import.meta.url))],
  bundle: true, outfile: tempFile, format: 'esm', platform: 'node', packages: 'external',
  plugins: [{ name: 'synthetic-auth', setup(builder) {
    builder.onResolve({ filter: /\/auth\.js$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const applyCors=()=>{};
      export const requireUser=async()=>({id:"synthetic-user"});
      export const createUserScopedClient=()=>({from:()=>({insert:()=>({abortSignal:async()=>({error:null})})})});` }));
  } }],
});
const { default: handler } = await import(pathToFileURL(tempFile).href);
fs.rmSync(tempFile, { force: true });

const response = () => {
  const res = { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  return res;
};
const withFetch = async (impl, run) => {
  const original = globalThis.fetch, env = { ...process.env };
  globalThis.fetch = impl;
  process.env.OLLAMA_BASE_URL = 'http://ollama.invalid:11434/';
  try { await run(); } finally { globalThis.fetch = original; process.env = env; }
};
const request = (body, method = 'POST') => ({ method, headers: {}, body });

test('local model routes only to Ollama and needs no paid key', () => {
  assert.deepEqual(MODEL_ROUTES['ollama/local'], ['ollama', 'openaicompat']);
  assert.equal(resolveProvider('ollama/local', 'auto', { ollama: true, openrouter: true }), 'ollama');
  assert.throws(() => resolveProvider('ollama/local', 'openrouter', { openrouter: true }));
  assert.throws(() => resolveProvider('ollama/local', 'auto', { openrouter: true }), /OLLAMA_BASE_URL/);
});

test('Ollama address: desktop default, hosted opt-in, kill switch and unsafe URLs', () => {
  assert.equal(ollamaBaseUrl({ BANANA_RUNTIME: 'local' }), 'http://127.0.0.1:11434');
  assert.equal(ollamaBaseUrl({}), null);
  assert.equal(ollamaBaseUrl({ OLLAMA_BASE_URL: 'https://gpu.example.invalid/ollama/' }), 'https://gpu.example.invalid/ollama');
  assert.equal(ollamaBaseUrl({ BANANA_RUNTIME: 'local', OLLAMA_ENABLED: 'false' }), null);
  for (const value of ['ftp://host', 'http://user:pass@host', 'not a url']) assert.equal(ollamaBaseUrl({ OLLAMA_BASE_URL: value }), null);
  assert.equal(ollamaContextSize('32768'), 32768);
  assert.equal(ollamaContextSize('12'), 16384);
  assert.ok(isOllamaModelName('qwen3:8b') && isOllamaModelName('hf.co/org/model:Q4_K_M'));
  assert.ok(!isOllamaModelName('../x') && !isOllamaModelName('a b') && !isOllamaModelName(''));
});

test('chat payload merges text, attaches images and inlines schema refs', () => {
  const schema = buildBrainstormOutputFormat(false, 2).schema;
  const chat = buildOllamaChat({ model: 'gemma3', system: 'S', numCtx: 8192, schema,
    parts: [{ text: 'A' }, { inlineData: { data: 'AAAA' } }, { text: 'B' }] });
  assert.equal(chat.stream, false);
  assert.deepEqual(chat.messages[1], { role: 'user', content: 'A\n\nB', images: ['AAAA'] });
  assert.equal(chat.options.num_ctx, 8192);
  assert.equal(JSON.stringify(chat.format).includes('$ref'), false);
  assert.equal(chat.format.properties.ideas.properties.idea_2.type, 'string');
  assert.deepEqual(inlineSchemaRefs({ type: 'string' }), { type: 'string' });
});

test('brainstorm runs on the chosen local model and returns normalized ideas', async () => {
  let sent;
  await withFetch(async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ done_reason: 'stop', message: { content: JSON.stringify({ ideas: { idea_1: 'One', idea_2: 'Two' } }) }, prompt_eval_count: 10, eval_count: 5 }), { status: 200 });
  }, async () => {
    const res = response();
    await handler(request({ model: 'ollama/local', localModel: 'qwen3:8b', brainstormCount: 2,
      contents: { parts: [{ text: 'Ideas please' }] }, usageContext: { action: 'brainstorm', prompt: 'x' } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(sent.url, 'http://ollama.invalid:11434/api/chat');
    assert.equal(sent.body.model, 'qwen3:8b');
    assert.ok(sent.body.format);
    assert.deepEqual(JSON.parse(res.body.text), ['One', 'Two']);
    assert.equal(res.body.provider, 'ollama');
  });
});

test('invalid model names and YouTube footage are rejected before contacting Ollama', async () => {
  await withFetch(async () => { throw new Error('Unexpected Ollama call'); }, async () => {
    for (const body of [
      { model: 'ollama/local', localModel: '../etc', contents: { parts: [{ text: 'x' }] }, usageContext: { action: 'enhance', prompt: 'x' } },
      { model: 'anthropic/claude-opus-5.5', localModel: 'qwen3', contents: { parts: [{ text: 'x' }] }, usageContext: { action: 'enhance', prompt: 'x' } },
      { model: 'ollama/local', localModel: 'qwen3', contents: { parts: [{ fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' } }, { text: 'x' }] }, usageContext: { action: 'enhance', prompt: 'x' } },
    ]) {
      const res = response();
      await handler(request(body), res);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
    }
  });
});

test('GET lists installed models and the server default', async () => {
  await withFetch(async url => {
    assert.equal(url, 'http://ollama.invalid:11434/api/tags');
    return new Response(JSON.stringify({ models: [{ name: 'gemma3:latest' }, { name: 'bad name' }] }), { status: 200 });
  }, async () => {
    process.env.OLLAMA_MODEL = 'gemma3:latest';
    const res = response();
    await handler(request(undefined, 'GET'), res);
    assert.deepEqual(res.body, { models: ['gemma3:latest'], defaultModel: 'gemma3:latest' });
  });
});

test('OpenAI-compatible server errors use LM Studio guidance, not Ollama commands', async () => {
  await withFetch(async url => {
    assert.equal(url, 'http://lmstudio.invalid:1234/v1/chat/completions');
    return new Response(JSON.stringify({ error: { message: 'model not loaded' } }), { status: 404 });
  }, async () => {
    process.env.LOCAL_OPENAI_BASE_URL = 'http://lmstudio.invalid:1234/v1';
    const res = response();
    await handler(request({ provider: 'openaicompat', model: 'ollama/local', localModel: 'qwen2.5-7b-instruct',
      contents: { parts: [{ text: 'x' }] }, usageContext: { action: 'enhance', prompt: 'x' } }), res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /LM Studio/);
    assert.doesNotMatch(res.body.error, /ollama pull/);
  });
});
