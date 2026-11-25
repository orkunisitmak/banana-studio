import type { ReferenceImage, ImageEditLayer } from '../../types.js';

export type { ImageEditLayer } from '../../types.js';

export type ImageEditRegion = NonNullable<ReferenceImage['editRegion']>;
export type ImageEditPoint = { x: number; y: number };
export const MAX_EDIT_REGION_POINTS = 256;
export const MAX_EDIT_LAYERS = 32;
export const EDIT_REGION_REQUIRED = 'Düzenlenecek alanı Edit area ile seç. Alanın dışındaki yüz ve diğer ayrıntılar kaynak görselden aynen korunacak.';

const isValidShape = (region: unknown): region is ImageEditRegion => {
  if (!region || typeof region !== 'object' || Array.isArray(region)) return false;
  const r = region as ImageEditRegion;
  const boundsValid = [r.x, r.y, r.width, r.height].every(v => typeof v === 'number' && Number.isFinite(v))
    && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0
    && r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9;
  if (!boundsValid) return false;
  if (r.points == null) return true;
  if (!Array.isArray(r.points) || r.points.length < 3 || r.points.length > MAX_EDIT_REGION_POINTS || r.points.some(p => !p
    || ![p.x, p.y].every(v => typeof v === 'number' && Number.isFinite(v))
    || p.x < r.x - 1e-9 || p.y < r.y - 1e-9 || p.x > r.x + r.width + 1e-9 || p.y > r.y + r.height + 1e-9)) return false;
  const area = r.points.reduce((sum, p, index) => { const next = r.points![(index + 1) % r.points!.length]; return sum + p.x * next.y - next.x * p.y; }, 0);
  return Math.abs(area) > 1e-8;
};

export const isValidEditRegion = (region: unknown): region is ImageEditRegion => {
  if (!isValidShape(region)) return false;
  if (region.expandsCanvas !== undefined && typeof region.expandsCanvas !== 'boolean') return false;
  if (region.layers === undefined) return true;
  if (region.points != null || !Array.isArray(region.layers) || !region.layers.length || region.layers.length > MAX_EDIT_LAYERS) return false;
  const ids = new Set<string>();
  return region.layers.every(layer => {
    if (!isValidShape(layer) || 'layers' in layer || typeof layer.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(layer.id)
      || ids.has(layer.id) || !['rectangle', 'mask'].includes(layer.tool)
      || (layer.tool === 'mask' && !layer.points) || (layer.tool === 'rectangle' && layer.points != null)
      || layer.x < region.x - 1e-9 || layer.y < region.y - 1e-9
      || layer.x + layer.width > region.x + region.width + 1e-9 || layer.y + layer.height > region.y + region.height + 1e-9) return false;
    ids.add(layer.id);
    return true;
  });
};

/** Older saved single selections remain editable as one ordinary layer. */
export const getEditRegionLayers = (region?: ImageEditRegion): ImageEditLayer[] => {
  if (!isValidEditRegion(region)) return [];
  if (region.layers) return region.layers;
  return [{ id: 'selection-1', tool: region.points ? 'mask' : 'rectangle', x: region.x, y: region.y, width: region.width, height: region.height,
    ...(region.points ? { points: region.points } : {}) }];
};

export const regionFromLayers = (layers: ImageEditLayer[]): ImageEditRegion | undefined => {
  if (!layers.length) return undefined;
  const x = Math.min(...layers.map(layer => layer.x)), y = Math.min(...layers.map(layer => layer.y));
  const region = { x, y, width: Math.max(...layers.map(layer => layer.x + layer.width)) - x,
    height: Math.max(...layers.map(layer => layer.y + layer.height)) - y, layers };
  return isValidEditRegion(region) ? region : undefined;
};

/** Keep only validated geometry when receiving an edit from a client. */
export const copyEditRegion = (region: ImageEditRegion): ImageEditRegion => {
  if (!isValidEditRegion(region)) throw new Error('Invalid edit area.');
  const shape = (value: ImageEditRegion) => ({ x: value.x, y: value.y, width: value.width, height: value.height,
    ...(value.points ? { points: value.points.map(point => ({ x: point.x, y: point.y })) } : {}) });
  return { ...shape(region), ...(region.layers ? { layers: region.layers.map(layer => ({ ...shape(layer), id: layer.id, tool: layer.tool })) } : {}),
    ...(region.expandsCanvas ? { expandsCanvas: true } : {}) };
};

/** Bounded provider guidance describes each object separately. Full contours
 * are retained for compositing; sampling here cannot change protected pixels. */
export const describeEditRegion = (region: ImageEditRegion, width: number, height: number): string => {
  const layers = getEditRegionLayers(region);
  const intro = region.expandsCanvas
    ? `EXPAND CANVAS\nThe ${width}x${height} SOURCE canvas holds the original image plus ${layers.length} new areas that only contain placeholder fill. Paint these areas as a natural continuation of the original scene: continue its perspective, lighting, colors, textures and any objects cut by the original border. Do not add frames, borders or text. Keep the original image exactly where it is; do not move, scale or crop it.\n`
    : `EDIT AREAS\nApply the requested change only to the union of these ${layers.length} selected areas on the ${width}x${height} SOURCE canvas. Gaps between areas remain unchanged. Preserve source alignment; do not move, scale or crop the scene.\n`;
  return intro + layers.map((layer, index) => {
    const bounds = editRegionPixels(layer, width, height);
    let line = `Area ${index + 1}: x=${bounds.left}, y=${bounds.top}, width=${bounds.width}, height=${bounds.height}.`;
    if (layer.points) {
      const count = Math.min(12, layer.points.length);
      const points = Array.from({ length: count }, (_, i) => layer.points![Math.floor(i * layer.points!.length / count)]);
      line += ` Object outline (pixel vertices): ${points.map(point => `(${Math.round(point.x * width)},${Math.round(point.y * height)})`).join(', ')}.`;
    }
    return line;
  }).join('\n');
};

export const describeEditRegionPercent = (region: ImageEditRegion): string => {
  const percent = (value: number) => Number((value * 100).toFixed(2));
  const intro = region.expandsCanvas
    ? 'EXPAND CANVAS\nThe SOURCE image is the original picture plus new areas that only contain placeholder fill. Paint these areas as a natural continuation of the original scene: continue its perspective, lighting, colors, textures and any objects cut by the original border. Do not add frames, borders or text. Coordinates are percentages of SOURCE image width and height. Keep the original picture unchanged and in place.\n'
    : 'EDIT AREAS\nEdit only the union of the following selected objects. Coordinates are percentages of SOURCE image width and height. Keep gaps, faces and everything outside these selections unchanged; preserve source alignment.\n';
  return intro + getEditRegionLayers(region).map((layer, index) => {
    let line = `Area ${index + 1}: x=${percent(layer.x)}%, y=${percent(layer.y)}%, width=${percent(layer.width)}%, height=${percent(layer.height)}%.`;
    if (layer.points) {
      const count = Math.min(12, layer.points.length);
      const points = Array.from({ length: count }, (_, i) => layer.points![Math.floor(i * layer.points!.length / count)]);
      line += ` Object outline: ${points.map(point => `(${percent(point.x)}%,${percent(point.y)}%)`).join(', ')}.`;
    }
    return line;
  }).join('\n');
};

export const regionFromPoints = (points: ImageEditPoint[]): ImageEditRegion => {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y, points };
};

/** Normalize screen input against the image itself, not its letterboxed frame. */
export const normalizeEditPoint = (point: ImageEditPoint, bounds: { left: number; top: number; width: number; height: number }): ImageEditPoint => ({
  x: Math.max(0, Math.min(1, (point.x - bounds.left) / (bounds.width || 1))),
  y: Math.max(0, Math.min(1, (point.y - bounds.top) / (bounds.height || 1))),
});

const simplifyContour = (points: ImageEditPoint[], tolerance: number, aspect: number) => {
  if (points.length < 4) return points;
  const keep = new Set([0, points.length - 1]);
  const segments: [number, number][] = [[0, points.length - 1]];
  while (segments.length) {
    const [start, end] = segments.pop()!;
    const a = points[start], b = points[end];
    const dx = (b.x - a.x) * aspect, dy = b.y - a.y;
    let furthest = -1, distance = tolerance * tolerance;
    for (let index = start + 1; index < end; index++) {
      const px = (points[index].x - a.x) * aspect, py = points[index].y - a.y;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
      const squared = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (squared > distance) { furthest = index; distance = squared; }
    }
    if (furthest !== -1) {
      keep.add(furthest);
      segments.push([start, furthest], [furthest, end]);
    }
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]);
};

/** A pointer contour becomes one closed, filled mask on release. The closing
 * point is implicit in SVG and the server polygon rasterizer. Simplification
 * is measured in displayed pixels so a long mouse stroke stays bounded. */
export const regionFromFreehand = (
  input: ImageEditPoint[], display: { width: number; height: number },
): ImageEditRegion | undefined => {
  const points: ImageEditPoint[] = [];
  for (const point of input) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const p = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) };
    const previous = points.at(-1);
    if (!previous || previous.x !== p.x || previous.y !== p.y) points.push(p);
  }
  if (points.length < 3) return undefined;
  const first = points[0], last = points.at(-1)!;
  if (first.x === last.x && first.y === last.y) points.pop();
  if (points.length < 3) return undefined;
  const closed = [...points, points[0]];
  const aspect = Math.max(1, display.width) / Math.max(1, display.height);
  let tolerance = 1.25 / Math.max(1, display.height);
  let simplified = simplifyContour(closed, tolerance, aspect).slice(0, -1);
  while (simplified.length > MAX_EDIT_REGION_POINTS) {
    tolerance *= 1.35;
    simplified = simplifyContour(closed, tolerance, aspect).slice(0, -1);
  }
  if (simplified.length < 3) return undefined;
  const region = regionFromPoints(simplified);
  return isValidEditRegion(region) ? region : undefined;
};

export const editRegionPixels = (region: ImageEditRegion, width: number, height: number) => {
  if (!isValidEditRegion(region)) throw new Error('Invalid edit area.');
  const left = Math.max(0, Math.floor(region.x * width));
  const top = Math.max(0, Math.floor(region.y * height));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(height, Math.ceil((region.y + region.height) * height));
  return { left, top, width: right - left, height: bottom - top };
};
