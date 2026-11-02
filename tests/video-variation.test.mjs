import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = await build({ entryPoints: [new URL('../src/lib/gallery/recreateDraft.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', logLevel: 'silent' });
const { canGenerateVariation } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

test('Variation is offered for images and not for videos', () => {
  assert.equal(canGenerateVariation({ id: 'a', mediaType: 'image' }), true);
  assert.equal(canGenerateVariation({ id: 'b' }), true);
  assert.equal(canGenerateVariation({ id: 'c', mediaType: 'video' }), false);
});
