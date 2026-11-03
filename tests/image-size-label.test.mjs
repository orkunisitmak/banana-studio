import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({ stdin: { contents: `
  export { hasImageSizeMismatch } from './src/lib/images/openaiImage';
  export { getGalleryAspectRatio } from './src/components/galleryPresentation';
`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' });
const { hasImageSizeMismatch, getGalleryAspectRatio } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('a preset label never counts as an output size mismatch', () => {
  assert.equal(hasImageSizeMismatch({ imageRequestedSize: '2K · 16:9', imageOutputSize: '2816x1584' }), false);
  assert.equal(hasImageSizeMismatch({ imageRequestedSize: '1K · 1:1', imageOutputSize: '1024x1024' }), false);
});

test('requested pixel sizes are still compared with the output', () => {
  assert.equal(hasImageSizeMismatch({ imageRequestedSize: '1536x864', imageOutputSize: '1024x1024' }), true);
  assert.equal(hasImageSizeMismatch({ imageRequestedSize: '1024x1024', imageOutputSize: '1024x1024' }), false);
  assert.equal(hasImageSizeMismatch({ imageRequestedSize: 'auto', imageOutputSize: '1024x1024' }), false);
});

test('a pending card with a preset label keeps its selected aspect ratio', () => {
  const pending = { mediaType: 'image', isLoading: true, aspectRatio: '16:9' };
  assert.equal(getGalleryAspectRatio({ ...pending, imageRequestedSize: '2K · 16:9' }), 16 / 9);
  assert.equal(getGalleryAspectRatio({ ...pending, aspectRatio: '9:16', imageRequestedSize: '1K · 9:16' }), 9 / 16);
});

test('pending pixel sizes and finished output sizes still decide the card shape', () => {
  assert.equal(getGalleryAspectRatio({ mediaType: 'image', isLoading: true, aspectRatio: '1:1', imageRequestedSize: '1536x864' }), 1536 / 864);
  assert.equal(getGalleryAspectRatio({ mediaType: 'image', isLoading: true, aspectRatio: '16:9', imageRequestedSize: 'auto' }), 1);
  assert.equal(getGalleryAspectRatio({ mediaType: 'image', aspectRatio: '1:1', imageRequestedSize: '2K · 16:9', imageOutputSize: '2816x1584' }), 2816 / 1584);
});
