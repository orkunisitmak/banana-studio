const interpolate = (a: number, b: number, c: number, d: number, fx: number, fy: number) =>
  (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;

/** Bilinear resize for tier-based providers. Runs before selected pixels are
 * composited; source pixels outside the selection are never resampled. */
export function resizePixels(data: Uint8Array, width: number, height: number, targetWidth: number, targetHeight: number): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + .5) * height / targetHeight - .5)), y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + .5) * width / targetWidth - .5)), x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4;
      const c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4;
      const target = (y * targetWidth + x) * 4;
      const sameOpacity = data[a + 3] === data[b + 3] && data[a + 3] === data[c + 3] && data[a + 3] === data[d + 3];
      const opacity = sameOpacity ? data[a + 3] : interpolate(data[a + 3], data[b + 3], data[c + 3], data[d + 3], fx, fy);
      // Interpolate premultiplied colors, then return straight RGBA pixels.
      for (let channel = 0; channel < 3; channel++) output[target + channel] = Math.round(sameOpacity && opacity
        ? interpolate(data[a + channel], data[b + channel], data[c + channel], data[d + channel], fx, fy)
        : opacity ? interpolate(data[a + channel] * data[a + 3], data[b + channel] * data[b + 3],
          data[c + channel] * data[c + 3], data[d + channel] * data[d + 3], fx, fy) / opacity : 0);
      output[target + 3] = Math.round(opacity);
    }
  }
  return output;
}
