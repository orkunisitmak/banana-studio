import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `export * from './src/lib/brainstorm/brainstormLabels';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { brainstormSummary, brainstormImageCount } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('one idea with one image reads in the singular', () => {
  assert.equal(brainstormSummary(1, 1, 1), '1 idea × 1 image = 1 image');
});

test('several ideas and images read in the plural', () => {
  assert.equal(brainstormSummary(5, 2, 10), '5 ideas × 2 images = 10 images');
  assert.equal(brainstormSummary(1, 3, 3), '1 idea × 3 images = 3 images');
});

test('toast image counts are singular for one image', () => {
  assert.equal(brainstormImageCount(1), '1 image');
  assert.equal(brainstormImageCount(0), '0 images');
  assert.equal(brainstormImageCount(4), '4 images');
});
