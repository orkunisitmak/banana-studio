import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: ['src/lib/video/videoProviderName.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { videoProviderName } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

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
