import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider } from '../src/lib/providers.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../api/_lib/anthropicText.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildAnthropicMessage, readAnthropicMessage, calculateAnthropicCost } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('web setup in both languages accepts an Anthropic-only Opus key', () => {
  for (const lang of ['en', 'tr']) {
    const deploy = fs.readFileSync(fileURLToPath(new URL(`../docs/${lang}/deploy.md`, import.meta.url)), 'utf8');
    const models = fs.readFileSync(fileURLToPath(new URL(`../docs/${lang}/models.md`, import.meta.url)), 'utf8');
    assert.match(deploy, /Opus 5\.5[^\n]*`ANTHROPIC_API_KEY`[^\n]*`OPENROUTER_API_KEY`/);
    assert.doesNotMatch(deploy, /Opus 5\.5[^\n]*(?:requires OpenRouter|OpenRouter ister)/);
    assert.match(models, /\| Anthropic \| \[[^\]]+\]\(https:\/\/platform\.claude\.com\/settings\/keys\)/);
  }
});

test('Claude can use a direct Anthropic key without OpenRouter', () => {
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'auto', { anthropic: true }), 'anthropic');
  assert.equal(resolveProvider('anthropic/claude-opus-5.5', 'anthropic', { anthropic: true }), 'anthropic');
});

test('native Messages payload maps text, base64 image and structured brainstorm without OpenRouter fields', () => {
  const request = buildAnthropicMessage({ model: 'anthropic/claude-opus-5.5', contents: { parts: [
    { text: 'Describe the image' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
  ] }, reasoningEffort: 'medium', brainstormCount: 2, usageContext: { action: 'brainstorm', prompt: 'ideas' } });
  assert.equal(request.model, 'claude-opus-5-5');
  assert.equal(request.output_config.effort, 'medium');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.messages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } });
  assert.equal(request.messages[0].content[0].type, 'text');
  assert.equal(request.reasoning, undefined);
  assert.equal(request.response_format, undefined);
});

test('malformed base64 image data is rejected before a paid provider call', () => {
  assert.throws(() => buildAnthropicMessage({ model: 'anthropic/claude-opus-5.5',
    contents: { parts: [{ text: 'Describe this' }, { inlineData: { mimeType: 'image/png', data: 'a' } }] },
    usageContext: { action: 'enhance', prompt: 'Describe this' } }), /image references/);
});

test('Opus 5.5 supports Max effort through the direct Anthropic API', () => {
  const request = buildAnthropicMessage({ model: 'anthropic/claude-opus-5.5', contents: { parts: [{ text: 'Write a brief.' }] },
    reasoningEffort: 'max', usageContext: { action: 'enhance', prompt: 'brief' } });
  assert.equal(request.output_config.effort, 'max');
});

test('native Messages response exposes text, usage and rejects incomplete output', () => {
  assert.equal(readAnthropicMessage({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hello' }] }), 'hello');
  assert.throws(() => readAnthropicMessage({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }));
  assert.equal(calculateAnthropicCost({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), 0.006);
});

test('Opus cost accounts for cache reads and one-hour writes at native rates', () => {
  assert.equal(calculateAnthropicCost({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } }), 0.0142);
});

test('server route, frontend route and desktop vaults expose direct Anthropic without a browser key', () => {
  const read = name => fs.readFileSync(fileURLToPath(new URL('../' + name, import.meta.url)), 'utf8');
  assert.match(read('api/anthropic-text-generate.ts'), /api\.anthropic\.com\/v1\/messages/);
  assert.match(read('src/services/geminiClient.ts'), /\/api\/anthropic-text-generate/);
  assert.match(read('desktop/server/main.mjs'), /anthropic-text-generate/);
  assert.match(read('desktop/server/main.mjs'), /'ANTHROPIC_API_KEY'/);
  assert.match(read('desktop/macos/Sources/BananaStudio/KeyVault.swift'), /ANTHROPIC_API_KEY/);
  assert.match(read('desktop/windows/KeyVault.cs'), /ANTHROPIC_API_KEY/);
  assert.match(read('api/gemini-status.ts'), /providers\.anthropic/);
});

async function loadHandler() {
  const route = await build({ entryPoints: [fileURLToPath(new URL('../api/anthropic-text-generate.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'anthropic-handler-fixture', setup(builder) {
      builder.onResolve({ filter: /_lib\/(auth|openaiGuard)\.js$/ }, args => ({ path: args.path.includes('auth') ? 'auth' : 'guard', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'auth'
        ? `export const applyCors = () => {}; export const requireUser = async () => ({ id: 'fixture-user' }); export const createUserScopedClient = () => ({ from: () => ({ insert: () => ({ abortSignal: async () => ({ error: globalThis.__anthropicUsageError ?? null }) }) }) });`
        : `export const startOpenAIRequest = async () => ({ id: 'fixture-request', finish: async () => {} });`, loader: 'js' }));
    } }] });
  const { default: handler } = await import('data:text/javascript;base64,' + Buffer.from(route.outputFiles[0].text).toString('base64'));
  return handler;
}

async function runHandlerScenario(providerResponse, usageError = null) {
  const handler = await loadHandler();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return providerResponse; };
  globalThis.__anthropicUsageError = usageError;
  process.env.ANTHROPIC_API_KEY = 'fixture-not-a-real-key';
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, off() {} };
  try {
    await handler({ method: 'POST', headers: {}, body: { model: 'anthropic/claude-opus-5.5', contents: { parts: [{ text: 'hello' }] }, usageContext: { action: 'enhance', prompt: 'hello' } } }, res);
    return { res, calls };
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__anthropicUsageError;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
}

test('a non-JSON provider 529 remains a retryable 529 without a second paid request', async () => {
  const { res, calls } = await runHandlerScenario(new Response('temporarily overloaded', { status: 529 }));
  assert.equal(res.statusCode, 529);
  assert.match(res.body.error, /busy or rate limited/);
  assert.equal(calls, 1);
});

test('an incomplete provider reply fails rather than returning partial text or repeating the request', async () => {
  const { res, calls } = await runHandlerScenario(Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }));
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /did not finish/);
  assert.equal(calls, 1);
});

test('a usage log insert error returns the result with usageLogged false', async () => {
  const { res, calls } = await runHandlerScenario(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'complete' }], usage: { input_tokens: 1, output_tokens: 1 } }), { message: 'fixture write failure' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.text, 'complete');
  assert.equal(res.body.usageMetadata.usageLogged, false);
  assert.equal(calls, 1);
});
