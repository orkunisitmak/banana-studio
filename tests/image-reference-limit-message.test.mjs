import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: ['src/lib/images/imageReferences.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { imageReferenceError } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const refs = count => Array.from({ length: count }, () => ({ data: 'https://example.com/a.png' }));

test('Nano Banana names its limit of 14', () => {
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', refs(15)), 'Attach up to 14 valid reference images.');
  assert.equal(imageReferenceError('gemini-3-pro-image-preview', refs(16)), 'Attach up to 14 valid reference images.');
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', refs(14)), null);
});

test('GPT Image 2.5 names its limit of 16', () => {
  assert.equal(imageReferenceError('gpt-image-2.5-sunburst', refs(17)), 'Attach up to 16 valid reference images.');
  assert.equal(imageReferenceError('gpt-image-2.5-sunburst', refs(16)), null);
});

test('a reference without data is refused with the model limit', () => {
  assert.equal(imageReferenceError('gemini-nano-banana-2.1', [{ data: '' }]), 'Attach up to 14 valid reference images.');
});
