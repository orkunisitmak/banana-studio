import type { AspectRatio } from '../../types.js';
import { regionFromLayers, type ImageEditLayer, type ImageEditRegion } from './imageEditRegion.js';

/** Where the original image sits along the axis that grows. */
export type OutpaintAnchor = 'start' | 'center' | 'end';

export const OUTPAINT_RATIOS: AspectRatio[] = ['16:9', '4:3', '1:1', '3:4', '9:16'];

// Every edit model accepts these canvases: multiples of 16, at most 3840 px per
// edge and 655,360–8,294,400 pixels (GPT Image), in a ratio Nano Banana supports.
const MAX_EDGE = 3840, MAX_PIXELS = 8_294_400, MIN_PIXELS = 655_360;

export interface OutpaintLayout {
  width: number;
  height: number;
  /** The original image's placement on the new canvas, in pixels. */
  image: { left: number; top: number; width: number; height: number };
  region: ImageEditRegion;
}

const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

export const isOutpaintRatioDifferent = (width: number, height: number, ratio: AspectRatio): boolean => {
  const [a, b] = ratio.split(':').map(Number);
  return Math.abs(width / height / (a / b) - 1) > .01;
};

/**
 * Grow the canvas to `ratio` along one axis and mark the new areas, plus a
 * thin seam inside the original, as the edit region. Everything else on the
 * canvas is the original image and is preserved by the protected edit.
 */
export const computeOutpaintLayout = (sourceWidth: number, sourceHeight: number, ratio: AspectRatio, anchor: OutpaintAnchor = 'center'): OutpaintLayout | null => {
  if (!(sourceWidth > 0 && sourceHeight > 0) || !OUTPAINT_RATIOS.includes(ratio) || !isOutpaintRatioDifferent(sourceWidth, sourceHeight, ratio)) return null;
  const [rawA, rawB] = ratio.split(':').map(Number);
  const divisor = gcd(rawA, rawB), a = rawA / divisor, b = rawB / divisor;
  const wider = a / b > sourceWidth / sourceHeight;
  // The new canvas at the original image's scale.
  const idealWidth = wider ? sourceHeight * a / b : sourceWidth;
  const idealHeight = wider ? sourceHeight : sourceWidth * b / a;
  // Exact ratio in 16 px steps: width = 16·a·m, height = 16·b·m.
  const unitWidth = 16 * a, unitHeight = 16 * b;
  let m = Math.max(1, Math.round(Math.sqrt(idealWidth * idealHeight / (unitWidth * unitHeight))));
  while (m > 1 && (unitWidth * m > MAX_EDGE || unitHeight * m > MAX_EDGE || unitWidth * unitHeight * m * m > MAX_PIXELS)) m--;
  while (unitWidth * unitHeight * m * m < MIN_PIXELS) m++;
  const width = unitWidth * m, height = unitHeight * m;
  const scale = wider ? height / sourceHeight : width / sourceWidth;
  const imageWidth = Math.min(width, Math.round(sourceWidth * scale)), imageHeight = Math.min(height, Math.round(sourceHeight * scale));
  const free = wider ? width - imageWidth : height - imageHeight;
  const offset = anchor === 'start' ? 0 : anchor === 'end' ? free : Math.round(free / 2);
  const image = { left: wider ? offset : 0, top: wider ? 0 : offset, width: imageWidth, height: imageHeight };
  // Regenerate a thin seam of the original so the model can join both sides.
  const seam = Math.max(8, Math.min(32, Math.round(Math.min(imageWidth, imageHeight) * .02)));
  const layers: ImageEditLayer[] = [];
  const add = (id: string, left: number, top: number, right: number, bottom: number) => {
    if (right > left && bottom > top) layers.push({ id, tool: 'rectangle', x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height });
  };
  if (wider) {
    if (image.left > 0) add('expand-left', 0, 0, Math.min(width, image.left + seam), height);
    if (image.left + imageWidth < width) add('expand-right', Math.max(0, image.left + imageWidth - seam), 0, width, height);
  } else {
    if (image.top > 0) add('expand-top', 0, 0, width, Math.min(height, image.top + seam));
    if (image.top + imageHeight < height) add('expand-bottom', 0, Math.max(0, image.top + imageHeight - seam), width, height);
  }
  const region = regionFromLayers(layers);
  return region ? { width, height, image, region: { ...region, expandsCanvas: true } } : null;
};
