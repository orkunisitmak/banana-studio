import type { BrandKit } from '../brand/kit';
import { getCoverRect, type ExportPreset } from './presets';

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
}

const loadImage = async (url: string): Promise<LoadedImage> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('The image could not be downloaded for export.');
  const blob = await response.blob();
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = objectUrl;
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
};

const fitText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
};

const drawLogo = async (ctx: CanvasRenderingContext2D, dataUrl: string, x: number, y: number, maxWidth: number): Promise<void> => {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
  ctx.drawImage(image, x, y, image.naturalWidth * scale, image.naturalHeight * scale);
};

export const renderBrandedPreset = async ({
  imageUrl,
  preset,
  brandKit,
  title,
}: {
  imageUrl: string;
  preset: ExportPreset;
  brandKit: BrandKit;
  title?: string;
}): Promise<HTMLCanvasElement> => {
  const canvas = document.createElement('canvas');
  canvas.width = preset.width;
  canvas.height = preset.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot render export presets.');
  const image = await loadImage(imageUrl);
  try {
    const rect = getCoverRect(image.width, image.height, preset.width, preset.height);
    ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height);

    const gradient = ctx.createLinearGradient(0, preset.height * 0.5, 0, preset.height);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.82)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, preset.width, preset.height);

    const margin = Math.round(Math.min(preset.width, preset.height) * (brandKit.safeMargin / 100));
    const contentWidth = preset.width - margin * 2;
    const accentHeight = Math.max(6, Math.round(preset.height * 0.008));
    const titleSize = Math.round(Math.min(preset.width, preset.height) * 0.045);
    const brandSize = Math.max(16, Math.round(titleSize * 0.55));
    const ruleY = preset.height - margin - brandSize - Math.round(brandSize * 0.4) - accentHeight;
    ctx.fillStyle = brandKit.accentColor;
    ctx.fillRect(margin, ruleY, Math.min(contentWidth, Math.round(preset.width * 0.18)), accentHeight);

    ctx.font = `700 ${titleSize}px ${brandKit.fontFamily}, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    const cleanTitle = (title || '').replace(/\s+/g, ' ').trim();
    const titleText = cleanTitle ? fitText(ctx, cleanTitle, contentWidth) : '';
    if (titleText) ctx.fillText(titleText, margin, ruleY - Math.round(titleSize * 0.6));

    ctx.font = `600 ${brandSize}px ${brandKit.fontFamily}, sans-serif`;
    ctx.fillStyle = brandKit.accentColor;
    ctx.fillText(brandKit.name.toUpperCase(), margin, preset.height - margin);

    if (brandKit.logoDataUrl) {
      const logoMax = Math.round(Math.min(preset.width, preset.height) * 0.16);
      await drawLogo(ctx, brandKit.logoDataUrl, preset.width - margin - logoMax, margin, logoMax);
    }
  } finally {
    image.close?.();
  }
  return canvas;
};

export const downloadCanvas = (canvas: HTMLCanvasElement, filename: string): Promise<void> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('The export could not be encoded.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      resolve();
    }, 'image/png');
  });
