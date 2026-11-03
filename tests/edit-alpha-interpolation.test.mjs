import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { resizePixels } from '../src/lib/images/resizePixels.ts';

const bundle = await build({ entryPoints: ['api/_lib/protectedImageEdit.ts'], absWorkingDir: fileURLToPath(new URL('..', import.meta.url)), bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'native-packages', setup(b) { b.onResolve({ filter: /^(sharp|node:.*)$/ }, args => ({ path: args.path.startsWith('node:') ? args.path : import.meta.resolve(args.path), external: true })); } }],
});
const { compositeProtectedEdit } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const width = 48, height = 48, region = { x: .25, y: .25, width: .5, height: .5 };
const fill = rgba => new Uint8Array(Array.from({ length: width * height }, () => rgba).flat());
const png = data => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
const edited = async (source, output) => {
  const result = await compositeProtectedEdit({ data: source, info: { width, height } }, await png(output), region);
  return new Uint8Array(await sharp(result.bytes).ensureAlpha().raw().toBuffer());
};
const pixel = (data, x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test('a transparent edit feathers out opacity without darkening or tinting the source color', async () => {
  const source = fill([0,0,255,255]);
  const result = await edited(source, fill([255,0,0,0]));
  // The 24px selection uses a three-pixel inward feather: first edge keeps 2/3 source alpha.
  assert.deepEqual(pixel(result, 12, 24), [0,0,255,170]);
  assert.equal(pixel(result, 24,24)[3], 0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < 12 || x >= 36 || y < 12 || y >= 36) assert.deepEqual(pixel(result,x,y), pixel(source,x,y));
  }
});
test('feathering onto a transparent source ignores its invisible RGB values', async () => {
  const result = await edited(fill([0,255,0,0]), fill([255,0,0,255]));
  assert.deepEqual(pixel(result,12,24), [255,0,0,85]);
  assert.deepEqual(pixel(result,24,24), [255,0,0,255]);
});
test('bilinear tier resizing does not mix invisible RGB into visible pixels', () => {
  const input = new Uint8Array([0,0,255,255, 255,0,0,0]);
  const result = resizePixels(input,2,1,3,1);
  assert.deepEqual(Array.from(result.slice(4,8)), [0,0,255,128]);
  assert.deepEqual(Array.from(input), [0,0,255,255,255,0,0,0]);
});
test('opaque interpolation retains its existing channel values', async () => {
  const result = await edited(fill([0,0,255,255]), fill([255,0,0,255]));
  assert.deepEqual(pixel(result,12,24), [85,0,170,255]);
  assert.deepEqual(Array.from(resizePixels(new Uint8Array([0,0,255,255,255,0,0,255]),2,1,3,1).slice(4,8)), [128,0,128,255]);
});

test('both partially transparent colors contribute in proportion to visible coverage', async () => {
  const result = await edited(fill([0,0,255,64]), fill([255,0,0,192]));
  assert.deepEqual(pixel(result,12,24), [153,0,102,107]);
});
test('two-dimensional resizing handles transparent and opaque neighborhoods without NaN', () => {
  const result = resizePixels(new Uint8Array([0,0,255,255, 255,0,0,0, 0,255,0,0, 255,255,255,0]),2,2,1,1);
  assert.deepEqual(Array.from(result), [0,0,255,64]);
  assert.deepEqual(Array.from(resizePixels(new Uint8Array([255,0,0,0, 0,255,0,0]),2,1,1,1)), [0,0,0,0]);
});
