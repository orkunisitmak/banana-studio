import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const bundle = await build({ stdin: { contents: `export { validateOpenAIImageSize } from './src/lib/images/openaiImage.ts'; export { compositeProtectedEdit } from './api/_lib/protectedImageEdit.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'native-packages', setup(b) { b.onResolve({ filter: /^(sharp|node:.*)$/ }, args => ({ path: args.path.startsWith('node:') ? args.path : import.meta.resolve(args.path), external: true })); } }],
});
const { validateOpenAIImageSize, compositeProtectedEdit } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('Codex accepts original canvases without relaxing API provider dimensions', () => {
  for (const size of ['1920x1080', '1537x1025', '4096x2304']) {
    assert.equal(validateOpenAIImageSize(size, 'codex'), null);
    for (const provider of ['openai', 'openrouter', 'fal', undefined]) assert.match(validateOpenAIImageSize(size, provider), /multiples of 16/);
  }
  for (const size of ['0x1024', '1024x0', '8192x8192', '9007199254740993x1', '1.5x1024', '-1x1024', null]) assert.equal(typeof validateOpenAIImageSize(size, 'codex'), 'string');
  assert.equal(validateOpenAIImageSize('1536x864', 'openai'), null);
});

test('resized Codex edits retain non-aligned source dimensions and every outside pixel', async () => {
  const width = 99, height = 66;
  const source = Buffer.alloc(width * height * 4);
  for (let i = 0; i < source.length; i++) source[i] = i % 256;
  const region = { x: 1 / 3, y: 1 / 3, width: 1 / 3, height: 1 / 3 };
  const generated = await sharp({ create: { width: 198, height: 132, channels: 4, background: { r: 230, g: 17, b: 55, alpha: 1 } } }).png().toBuffer();
  const result = await compositeProtectedEdit({ data: source, info: { width, height } }, generated, region, true);
  const decoded = await sharp(result.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width); assert.equal(decoded.info.height, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < 33 || x >= 66 || y < 22 || y >= 44) {
      const i = (y * width + x) * 4;
      assert.deepEqual(decoded.data.subarray(i, i + 4), source.subarray(i, i + 4));
    }
  }
  const center = (33 * width + 49) * 4;
  assert.deepEqual(Array.from(decoded.data.subarray(center, center + 4)), [230, 17, 55, 255]);
  await assert.rejects(compositeProtectedEdit({ data: source, info: { width, height } }, generated, region, false), /different canvas size/);
  const wrongRatio = await sharp({ create: { width: 198, height: 198, channels: 4, background: 'red' } }).png().toBuffer();
  await assert.rejects(compositeProtectedEdit({ data: source, info: { width, height } }, wrongRatio, region, true), /different canvas size/);
});
