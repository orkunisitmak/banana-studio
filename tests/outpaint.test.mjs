import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ stdin: { contents: `export * from './src/lib/images/outpaint.ts';
  export { compositeEditPixels } from './src/lib/images/imageEditPixels.ts';
  export { isValidEditRegion, copyEditRegion, describeEditRegion, describeEditRegionPercent, editRegionPixels } from './src/lib/images/imageEditRegion.ts';
  export { validateOpenAIImageSize } from './src/lib/images/openaiImage.ts';
  export { canUseNanoEditCanvas } from './src/components/galleryImageEdit.ts';`,
  resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

test('every expanded canvas is accepted by GPT Image and Nano Banana edits', () => {
  for (const [w, h] of [[1024, 1024], [1536, 1024], [1024, 1536], [3840, 2160], [2160, 3840], [640, 480], [4000, 3000], [512, 512]]) {
    for (const ratio of m.OUTPAINT_RATIOS) {
      const layout = m.computeOutpaintLayout(w, h, ratio, 'center');
      if (!m.isOutpaintRatioDifferent(w, h, ratio)) { assert.equal(layout, null, `${w}x${h} ${ratio}`); continue; }
      assert.ok(layout, `${w}x${h} ${ratio}`);
      assert.equal(m.validateOpenAIImageSize(`${layout.width}x${layout.height}`), null, `${w}x${h} → ${ratio}: ${layout.width}x${layout.height}`);
      assert.ok(m.canUseNanoEditCanvas(layout), `${layout.width}x${layout.height}`);
      const [a, b] = ratio.split(':').map(Number);
      assert.equal(layout.width * b, layout.height * a, 'exact ratio');
      assert.ok(m.isValidEditRegion(layout.region));
      assert.equal(layout.region.expandsCanvas, true);
      // The original keeps its proportions and stays fully on the canvas.
      const { image } = layout;
      assert.ok(Math.abs(image.width / image.height - w / h) / (w / h) < .01);
      assert.ok(image.left >= 0 && image.top >= 0 && image.left + image.width <= layout.width && image.top + image.height <= layout.height);
    }
  }
});

test('the anchor places the original and only new areas plus a thin seam are editable', () => {
  const start = m.computeOutpaintLayout(1024, 1024, '16:9', 'start');
  const center = m.computeOutpaintLayout(1024, 1024, '16:9', 'center');
  const end = m.computeOutpaintLayout(1024, 1024, '16:9', 'end');
  assert.equal(start.image.left, 0);
  assert.equal(end.image.left + end.image.width, end.width);
  assert.equal(center.image.left, Math.round((center.width - center.image.width) / 2));
  assert.deepEqual(start.region.layers.map(l => l.id), ['expand-right']);
  assert.deepEqual(center.region.layers.map(l => l.id), ['expand-left', 'expand-right']);
  const pixels = center.region.layers.map(layer => m.editRegionPixels(layer, center.width, center.height));
  const seam = pixels[0].left + pixels[0].width - center.image.left;
  assert.ok(seam >= 8 && seam <= 32, `seam ${seam}`);
  assert.equal(pixels[1].left + pixels[1].width, center.width);
  const tall = m.computeOutpaintLayout(1920, 1080, '9:16', 'end');
  assert.deepEqual(tall.region.layers.map(l => l.id), ['expand-top']);
  assert.equal(tall.image.top + tall.image.height, tall.height);
});

test('expanded areas blend into the original, not toward the canvas border', () => {
  const width = 64, height = 16;
  const source = new Uint8ClampedArray(width * height * 4).fill(0);
  const output = new Uint8ClampedArray(width * height * 4).fill(200);
  const band = { id: 'expand-right', tool: 'rectangle', x: 32 / width, y: 0, width: 32 / width, height: 1 };
  const plain = m.compositeEditPixels(source, output, width, height, { ...band, layers: [band] });
  const expanded = m.compositeEditPixels(source, output, width, height, { ...band, layers: [band], expandsCanvas: true });
  const at = (pixels, x, y) => pixels[(y * width + x) * 4];
  // An ordinary edit fades toward the canvas edge; an expansion reaches it at full strength.
  assert.ok(at(plain, 63, 8) < 200);
  assert.equal(at(expanded, 63, 8), 200);
  assert.equal(at(expanded, 50, 0), 200);
  // Both still feather into the original image and never touch outside pixels.
  assert.ok(at(expanded, 32, 8) < 200);
  assert.equal(at(expanded, 31, 8), 0);
});

test('the expansion flag survives server copies and changes the model instructions', () => {
  const layout = m.computeOutpaintLayout(1024, 1024, '16:9');
  assert.equal(m.copyEditRegion(layout.region).expandsCanvas, true);
  assert.equal(m.copyEditRegion({ ...layout.region, expandsCanvas: false }).expandsCanvas, undefined);
  assert.equal(m.isValidEditRegion({ ...layout.region, expandsCanvas: 'yes' }), false);
  assert.match(m.describeEditRegion(layout.region, layout.width, layout.height), /^EXPAND CANVAS/);
  assert.match(m.describeEditRegionPercent(layout.region), /^EXPAND CANVAS/);
  const { expandsCanvas, ...ordinary } = layout.region;
  assert.match(m.describeEditRegion(ordinary, layout.width, layout.height), /^EDIT AREAS/);
});
