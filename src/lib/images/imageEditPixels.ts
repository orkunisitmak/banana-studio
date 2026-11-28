import { editRegionPixels, getEditRegionLayers, type ImageEditRegion } from './imageEditRegion.js';

const MAX_FEATHER = 8;

/** Rasterize the selection union at pixel centers within its bounds. Scanline
 * filling keeps freehand contours cheap. Selected pixels hold `value`; `caps`
 * holds each pixel's feather divisor, taken from its own layer's size. */
const rasterizeEditSelection = (region: ImageEditRegion, width: number, height: number, feather: boolean) => {
  const value = feather ? MAX_FEATHER + 1 : 1;
  const bounds = editRegionPixels(region, width, height);
  const bw = bounds.width, bh = bounds.height;
  const selected = new Uint8Array(bw * bh);
  // Each layer feathers by its own size: a small layer next to a large one
  // must still reach full strength. Overlaps keep the larger feather.
  const caps = feather ? new Uint8Array(bw * bh) : undefined;
  for (const layer of getEditRegionLayers(region)) {
    const area = editRegionPixels(layer, width, height);
    const cap = Math.min(MAX_FEATHER, Math.floor(Math.min(area.width, area.height) / 12)) + 1;
    const points = layer.points?.map(p => ({ x: p.x * width, y: p.y * height }));
    for (let y = area.top - bounds.top; y < area.top + area.height - bounds.top; y++) {
      const py = bounds.top + y + .5;
      const intersections: number[] = [];
      if (points) {
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[j], b = points[i];
          if ((a.y > py) !== (b.y > py)) intersections.push(a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y));
        }
        intersections.sort((a, b) => a - b);
      } else intersections.push(area.left, area.left + area.width);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const start = Math.max(0, Math.ceil(intersections[i] - bounds.left - .5));
        const end = Math.min(bw, Math.ceil(intersections[i + 1] - bounds.left - .5));
        const first = y * bw + start, last = y * bw + end;
        selected.fill(value, first, last);
        if (caps) for (let i = first; i < last; i++) caps[i] = Math.max(caps[i], cap);
      }
    }
  }
  return { bounds, selected, caps };
};

/** Feather inward only; outside pixels always come directly from source. */
export const compositeEditPixels = (source: Uint8Array | Uint8ClampedArray, output: Uint8Array | Uint8ClampedArray, width: number, height: number, region: ImageEditRegion): Uint8ClampedArray => {
  if (source.length !== width * height * 4 || output.length !== source.length) throw new Error('Edit pixel dimensions do not match.');
  const result = new Uint8ClampedArray(source);
  // Distances start at the largest feather so the union stays one selection;
  // only the alpha divisor (caps) is per layer.
  const { bounds, selected: distances, caps } = rasterizeEditSelection(region, width, height, true);
  const bw = bounds.width, bh = bounds.height;
  // Two passes measure distance to unselected pixels, including canvas edges.
  // An expanded canvas has only placeholder fill beyond its edges, so its
  // new areas blend into the original image, never toward the border.
  const edge = (atCanvasEdge: boolean) => region.expandsCanvas && atCanvasEdge ? MAX_FEATHER + 1 : 1;
  const [left, top] = [edge(bounds.left === 0), edge(bounds.top === 0)];
  const [right, bottom] = [edge(bounds.left + bw === width), edge(bounds.top + bh === height)];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    if (distances[i]) distances[i] = Math.min(distances[i], x ? distances[i - 1] + 1 : left, y ? distances[i - bw] + 1 : top);
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const i = y * bw + x;
    if (!distances[i]) continue;
    distances[i] = Math.min(distances[i], x < bw - 1 ? distances[i + 1] + 1 : right, y < bh - 1 ? distances[i + bw] + 1 : bottom);
    const alpha = Math.min(1, distances[i] / caps![i]);
    const index = ((bounds.top + y) * width + bounds.left + x) * 4;
    if (alpha === 1) {
      for (let channel = 0; channel < 4; channel++) result[index + channel] = output[index + channel];
      continue;
    }
    if (source[index + 3] === output[index + 3]) {
      for (let channel = 0; channel < 3; channel++) result[index + channel] = Math.round(source[index + channel] * (1 - alpha) + output[index + channel] * alpha);
      result[index + 3] = source[index + 3];
      continue;
    }
    // PNG/ImageData channels are straight RGBA. Interpolate premultiplied
    // colors so invisible RGB cannot tint a partially transparent edit edge.
    const sourceWeight = source[index + 3] * (1 - alpha), outputWeight = output[index + 3] * alpha;
    const opacity = sourceWeight + outputWeight;
    for (let channel = 0; channel < 3; channel++) result[index + channel] = opacity
      ? Math.round((source[index + channel] * sourceWeight + output[index + channel] * outputWeight) / opacity) : 0;
    result[index + 3] = Math.round(opacity);
  }
  return result;
};

/** GPT Image 2.6 `markup`: a transparent PNG layer, the same size as the source,
 * that outlines each selected area in red. The outline sits just OUTSIDE the
 * selection, so any trace the model leaves is discarded by the protected
 * composite, which keeps every outside pixel from the source. */
export const buildEditMarkupPixels = (region: ImageEditRegion, width: number, height: number): Uint8ClampedArray => {
  const { bounds, selected } = rasterizeEditSelection(region, width, height, false);
  const stroke = Math.max(3, Math.min(12, Math.round(Math.min(width, height) / 200)));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const isSelected = (x: number, y: number) => x >= bounds.left && y >= bounds.top && x < bounds.left + bounds.width
    && y < bounds.top + bounds.height && selected[(y - bounds.top) * bounds.width + x - bounds.left] === 1;
  // Chamfer distance from the selection, limited to a box around it.
  const left = Math.max(0, bounds.left - stroke), top = Math.max(0, bounds.top - stroke);
  const right = Math.min(width, bounds.left + bounds.width + stroke), bottom = Math.min(height, bounds.top + bounds.height + stroke);
  const bw = right - left, bh = bottom - top, far = stroke + 1;
  const distance = new Uint8Array(bw * bh).fill(far);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    distance[i] = isSelected(left + x, top + y) ? 0 : Math.min(far, x ? distance[i - 1] + 1 : far, y ? distance[i - bw] + 1 : far);
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const i = y * bw + x;
    distance[i] = Math.min(distance[i], x < bw - 1 ? distance[i + 1] + 1 : far, y < bh - 1 ? distance[i + bw] + 1 : far);
    if (distance[i] > 0 && distance[i] <= stroke) {
      const index = ((top + y) * width + left + x) * 4;
      pixels[index] = 255; pixels[index + 1] = 0; pixels[index + 2] = 0; pixels[index + 3] = 255;
    }
  }
  return pixels;
};
