import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/gallery/generationLabel.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { getGenerationsInProgressLabel } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

test('one generation reads singular', () => {
  assert.equal(getGenerationsInProgressLabel(1), '1 generation in progress');
});

test('several generations read plural', () => {
  assert.equal(getGenerationsInProgressLabel(2), '2 generations in progress');
  assert.equal(getGenerationsInProgressLabel(3), '3 generations in progress');
  assert.equal(getGenerationsInProgressLabel(12), '12 generations in progress');
});
