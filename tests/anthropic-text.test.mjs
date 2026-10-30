import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider } from '../src/lib/providers.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../api/_lib/anthropicText.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildAnthropicMessage, readAnthropicMessage, calculateAnthropicCost } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

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
