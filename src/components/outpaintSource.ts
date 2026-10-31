import type { OutpaintLayout } from '../lib/images/outpaint';

/**
 * Draw the original onto the expanded canvas. New areas get a heavily blurred,
 * dimmed copy of the original as placeholder fill: the model sees matching
 * colors instead of a hard gray border, but no detail it could copy.
 */
export const renderOutpaintSource = async (url: string, layout: OutpaintLayout): Promise<string> => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode().catch(() => { throw new Error('The image could not be loaded for expanding. Reopen it and try again.'); });
  const canvas = document.createElement('canvas');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Expanding images is unavailable in this browser.');
  context.fillStyle = '#808080';
  context.fillRect(0, 0, layout.width, layout.height);
  if (typeof context.filter === 'string') {
    const cover = Math.max(layout.width / image.naturalWidth, layout.height / image.naturalHeight);
    const width = image.naturalWidth * cover, height = image.naturalHeight * cover;
    context.filter = `blur(${Math.round(Math.max(layout.width, layout.height) / 40)}px)`;
    context.drawImage(image, (layout.width - width) / 2, (layout.height - height) / 2, width, height);
    context.filter = 'none';
    context.fillStyle = 'rgba(128, 128, 128, 0.45)';
    context.fillRect(0, 0, layout.width, layout.height);
  }
  const { left, top, width, height } = layout.image;
  context.drawImage(image, left, top, width, height);
  return canvas.toDataURL('image/png');
};
