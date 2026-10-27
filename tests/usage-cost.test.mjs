import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiled = await build({ stdin: { contents: `export * as text from './src/lib/usage/textUsageCost.ts';
export * as video from './src/lib/video/videoPricing.ts';
export { estimateVideoCost as appEstimateVideoCost } from './src/types.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { text, video, appEstimateVideoCost } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('server routes accept only the text features that write usage rows', () => {
  for (const action of text.TEXT_USAGE_ACTIONS) assert.ok(text.isTextUsageContext({ action, prompt: '' }));
  for (const value of [null, {}, { action: 'generate', prompt: 'x' }, { action: 'video_generate', prompt: 'x' }, { action: 'enhance' }, { action: 'enhance', prompt: 5 }])
    assert.equal(text.isTextUsageContext(value), false);
});

test('OpenAI and OpenRouter text costs use returned usage and never guess invalid counts', () => {
  close(text.calculateOpenAITextCost({ input_tokens: 1000, output_tokens: 500 }), 0.007);
  // Above 272k input tokens, input bills at 2x and output at 1.5x; cached input bills at 10%.
  close(text.calculateOpenAITextCost({ input_tokens: 1_000_000, output_tokens: 100_000, input_tokens_details: { cached_tokens: 200_000 } }), 4.74);
  for (const usage of [undefined, { input_tokens: -1, output_tokens: 1 }, { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } }])
    assert.equal(text.calculateOpenAITextCost(usage), null);
  assert.equal(text.calculateOpenRouterTextCost({ cost: 0.12, prompt_tokens: 1 }), 0.12);
  assert.equal(text.calculateOpenRouterTextCost({ cost: -1 }), null);
  close(text.calculateOpenRouterTextCost({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 } }), 0.00534);
  // Token prices are published only for Opus; other OpenRouter models need native cost.
  assert.equal(text.calculateOpenRouterTextCost({ prompt_tokens: 1000, completion_tokens: 100 }, 'gemini-3.8-flash'), null);
});

test('Gemini Flash token math bills cached input at 10%, thoughts as output and falls back per call', () => {
  const intro = Date.UTC(2026, 9, 27), standard = Date.UTC(2027, 0, 1);
  const usage = { promptTokenCount: 10_000, candidatesTokenCount: 2000, thoughtsTokenCount: 1000, cachedContentTokenCount: 4000 };
  close(text.calculateGeminiTextCost(usage, intro), 0.01605);
  close(text.calculateGeminiTextCost(usage, standard), 0.0321);
  close(text.calculateGeminiTextCost({ promptTokenCount: 100, totalTokenCount: 600 }, intro), 0.00195);
  for (const metadata of [null, {}, { promptTokenCount: -5000, candidatesTokenCount: -1 }])
    assert.equal(text.calculateGeminiTextCost(metadata, intro), text.GEMINI_FLASH_FALLBACK_CALL_COST);
});

test('Seedance submission estimates come from the server-safe rate card the app also uses', () => {
  assert.equal(appEstimateVideoCost, video.estimateVideoCost);
  const plain = video.estimateVideoCost('seedance-2.0', '720p', 5, false);
  close(plain.credits, 67.5); close(plain.usd, 67.5 / video.EVOLINK_CREDITS_PER_USD);
  // Video input bills max(input, output) + output seconds at the with-video rate.
  close(video.estimateVideoCost('seedance-2.0', '720p', 5, true, 8).credits, 8.2215 * 13);
});

test('usage pricing stays out of the app types runtime graph and browsers never write usage rows', async () => {
  for (const entry of ['src/lib/usage/textUsageCost.ts', 'src/lib/video/videoPricing.ts']) {
    const { metafile } = await build({ entryPoints: [path.join(root, entry)], bundle: true, write: false, metafile: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    assert.ok(!Object.keys(metafile.inputs).some(input => input.endsWith('src/types.ts')), entry);
  }
  const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).filter(file => /\.tsx?$/.test(file));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, 'src', file), 'utf8'), /from\(\s*['"]usage_logs['"]\s*\)\s*\.(?:insert|upsert|update)\(/, file);
  for (const route of ['openai-text-generate', 'openrouter-text-generate', 'gemini-generate', 'seedance-video', 'evolink-generate'])
    assert.match(fs.readFileSync(path.join(root, 'api', `${route}.ts`), 'utf8'), /await recordUsage\(user\.id,/, route);
});
