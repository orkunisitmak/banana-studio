import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundled = await build({ stdin: { contents: `export * from './api/_lib/geminiTextChat'; export * from './api/_lib/textRouting'; export * from './src/lib/prompts/youtubeFootage'; export * from './src/lib/prompts/textModels'; export * from './src/lib/prompts/brainstormText';`, resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { buildGeminiChat, generateGeminiChat, hasYouTubeFootage, postEvoOpus, postTextChat, configureTextModelPreferences, resolveTextModelPreferences, resolveTextModelId, buildBrainstormTextInstruction, applyBrainstormTextPolicy } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const signal = new AbortController().signal;
const multimodal = { parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }, { text: 'Describe the image.' }] };

for (const [id, slug] of [['gemini-4-hydrogen', 'google/gemini-4-hydrogen'], ['gpt-6.2-sol', 'openai/gpt-6.2-sol'], ['claude-opus-5.5', 'anthropic/claude-opus-5.5']]) {
  test(`fal routes ${id} through the corresponding physical model without fallback`, async t => {
    const once = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://fal.run/openrouter/router/openai/v1/chat/completions');
      assert.equal(new Headers(init.headers).get('authorization'), 'Key fixture');
      assert.equal(init.redirect, 'error');
      const body = JSON.parse(init.body);
      assert.equal(body.model, slug);
      assert.deepEqual(body.reasoning, { effort: 'high', exclude: true });
      assert.equal(body.provider.allow_fallbacks, false);
      assert.deepEqual(body.messages[0].content.map(p => p.type), ['image_url', 'text']);
      return Response.json({});
    });
    await postTextChat('fal', 'fixture', id, buildGeminiChat(multimodal, { thinkingConfig: { thinkingLevel: 'HIGH' } }, false, false), signal);
    assert.equal(once.mock.callCount(), 1);
  });
}

test('EvoLink Hydrogen uploads only its own references, then returns normalized structured output', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(url);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture');
    if (calls.length === 1) {
      assert.equal(body.base64_data, 'data:image/png;base64,AAAA');
      return Response.json({ success: true, data: { file_url: 'https://example.invalid/image' } });
    }
    assert.equal(body.model, 'gemini-4-hydrogen');
    assert.equal(body.messages.at(-1).content[0].image_url.url, 'https://example.invalid/image');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(body.response_format.json_schema.schema.properties.ideas.required, ['idea_1', 'idea_2']);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ideas":{"idea_2":"Second","idea_1":"First"}}' } }], usage: { cost: 0.125, prompt_tokens: 8 } });
  });
  const result = await generateGeminiChat('evolink', 'fixture', buildGeminiChat(multimodal, {}, true, false, 2), signal, true, false, 2);
  assert.deepEqual(calls, ['https://files-api.evolink.ai/api/v1/files/upload/base64', 'https://direct.evolink.ai/v1/chat/completions']);
  assert.deepEqual(JSON.parse(result.text), ['First', 'Second']);
  assert.equal(result.usageMetadata.textProvider, 'evolink');
  assert.equal(result.usageMetadata.providerCost, 0.125);
});

test('failed EvoLink image upload cannot submit a paid completion', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false }));
  await assert.rejects(postTextChat('evolink', 'fixture', 'gemini-4-hydrogen', buildGeminiChat(multimodal, {}, false, false), signal), /No model request/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('EvoLink Opus uses Messages blocks, adaptive reasoning and the Anthropic schema shape', async t => {
  const { messages } = buildGeminiChat(multimodal, {}, false, false);
  const schema = { type: 'object', properties: { brief: { type: 'string' } } };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://direct.evolink.ai/v1/messages');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'claude-opus-5-5');
    assert.deepEqual(body.messages[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'Describe the image.' }]);
    assert.deepEqual(body.output_config, { effort: 'high', format: { type: 'json_schema', schema } });
    assert.equal(body.thinking.type, 'adaptive');
    return Response.json({});
  });
  await postEvoOpus('fixture', 'system', messages[0].content, 'high', schema, signal);
  assert.equal(fetch.mock.callCount(), 1);
});

test('only one canonical YouTube URL enables the native exception; chat rejects file references', () => {
  const video = { fileData: { fileUri: 'https://www.youtube.com/watch?v=abcdefghijk' } };
  assert.equal(hasYouTubeFootage({ parts: [video, ...multimodal.parts] }), true);
  assert.equal(hasYouTubeFootage({ parts: [video, video] }), false);
  assert.equal(hasYouTubeFootage({ parts: [{ fileData: { fileUri: `${video.fileData.fileUri}&list=playlist` } }] }), false);
  assert.equal(hasYouTubeFootage(multimodal), false);
  assert.throws(() => buildGeminiChat({ parts: [video, ...multimodal.parts] }, {}, false, false), /references/);
  assert.throws(() => buildGeminiChat(multimodal, { httpOptions: {} }, false, false), /configuration/);
});

test('account feature model overrides do not change the shared model or an earlier job', async () => {
  const prefs = { model: 'gemini-4-hydrogen', featureModels: { brainstorm: 'gpt-6.2-sol' }, thinkingLevel: 'HIGH', reasoningEffort: 'high' };
  const dispose = configureTextModelPreferences(async () => prefs);
  try {
    const captured = await resolveTextModelPreferences('brainstorm');
    assert.equal(captured.model, 'gpt-6.2-sol');
    assert.equal((await resolveTextModelPreferences('variation')).model, prefs.model);
    prefs.featureModels.brainstorm = 'claude-opus-5.5';
    assert.equal((await resolveTextModelPreferences('brainstorm')).model, 'claude-opus-5.5');
    assert.equal(captured.model, 'gpt-6.2-sol');
    assert.equal(resolveTextModelId('anthropic/claude-opus-5.5'), 'claude-opus-5.5');
    assert.equal(resolveTextModelId('arbitrary'), undefined);
  } finally { dispose(); }
});

test('text-free brainstorm requests constrain both idea preparation and dispatch exactly once', () => {
  const idea = 'An illuminated cinema marquee';
  assert.equal(buildBrainstormTextInstruction(false), '');
  assert.equal(applyBrainstormTextPolicy(idea, false), idea);
  assert.match(buildBrainstormTextInstruction(true), /overrides requests for visible text/);
  const prepared = applyBrainstormTextPolicy(idea, true);
  assert.match(prepared, /No text, no letters/);
  assert.equal(applyBrainstormTextPolicy(prepared, true), prepared);
});
