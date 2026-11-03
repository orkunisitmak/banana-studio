import { editRegionPixels, getEditRegionLayers, type ImageEditRegion } from './imageEditRegion.js';

const MAX_FEATHER = 8;

/** Rasterize at pixel centers, then feather inward only. Scanline filling keeps
 * freehand contours cheap; outside pixels always come directly from source. */
export const compositeEditPixels = (source: Uint8Array | Uint8ClampedArray, output: Uint8Array | Uint8ClampedArray, width: number, height: number, region: ImageEditRegion): Uint8ClampedArray => {
  if (source.length !== width * height * 4 || output.length !== source.length) throw new Error('Edit pixel dimensions do not match.');
  const bounds = editRegionPixels(region, width, height);
  const result = new Uint8ClampedArray(source);
  const bw = bounds.width, bh = bounds.height;
  const distances = new Uint8Array(bw * bh);
  // Each layer feathers by its own size: a small layer next to a large one
  // must still reach full strength. Overlaps keep the larger feather.
  const caps = new Uint8Array(bw * bh);
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
        // Distances start at the largest feather so the union stays one selection;
        // only the alpha divisor (caps) is per layer.
        for (let i = y * bw + start; i < y * bw + end; i++) { distances[i] = MAX_FEATHER + 1; caps[i] = Math.max(caps[i], cap); }
      }
    }
  }
  // Two passes measure distance to unselected pixels, including canvas edges.
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    if (distances[i]) distances[i] = Math.min(distances[i], x ? distances[i - 1] + 1 : 1, y ? distances[i - bw] + 1 : 1);
  }
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) {
    const i = y * bw + x;
    if (!distances[i]) continue;
    distances[i] = Math.min(distances[i], x < bw - 1 ? distances[i + 1] + 1 : 1, y < bh - 1 ? distances[i + bw] + 1 : 1);
    const alpha = Math.min(1, distances[i] / caps[i]);
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
