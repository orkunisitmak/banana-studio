import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: ['src/lib/video/videoProviderName.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { videoProviderName, brokenVideoProviderLabel } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('names the provider that holds the video', () => {
  assert.equal(videoProviderName('bs_fal_abc'), 'fal.ai');
  assert.equal(videoProviderName('bs_openrouter_abc'), 'OpenRouter');
  assert.equal(videoProviderName('task-unified-123'), 'EvoLink');
});

test('H3 videos are fal.ai whatever the task id looks like', () => {
  assert.equal(videoProviderName('anything', true), 'fal.ai');
});

test('a video without a task id falls back to EvoLink', () => {
  assert.equal(videoProviderName(undefined), 'EvoLink');
});

test('the broken video card line names the provider in text', () => {
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', taskId: 'bs_fal_abc' }), 'Held by fal.ai');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', taskId: 'bs_openrouter_abc' }), 'Held by OpenRouter');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', taskId: 'task-unified-123' }), 'Held by EvoLink');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', taskId: 'anything', videoModel: 'minimax-h3' }), 'Held by fal.ai');
});

test('an H3 video without a task id still names fal.ai, and other media get no line', () => {
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', videoModel: 'minimax-h3' }), 'Held by fal.ai');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video' }), null);
  assert.equal(brokenVideoProviderLabel({ mediaType: 'image', taskId: 'bs_fal_abc' }), null);
});

test('a video with no task id uses the provider saved on the row', () => {
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', generationProvider: 'openrouter' }), 'Held by OpenRouter');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', generationProvider: 'fal' }), 'Held by fal.ai');
  assert.equal(brokenVideoProviderLabel({ mediaType: 'video', taskId: 'bs_fal_abc', generationProvider: 'openrouter' }), 'Held by fal.ai');
});
