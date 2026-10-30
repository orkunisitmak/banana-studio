/**
 * Reference images sent to /api/gemini-generate must fit within Vercel's
 * 4.5 MB serverless function body limit (combined across the whole request).
 * Brainstorm and image-generation flows can attach 5–10 references at once,
 * so each one is resized before upload; PNG/WebP retain transparency.
 *
 * The 1568 px cap matches the maximum side length the Gemini image models
 * use internally. Resizing and lossy re-encoding can change image details.
 */

const MAX_DIMENSION = 1568;
const JPEG_QUALITY = 0.85;

const loadImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for compression'));
    img.src = dataUrl;
  });

/** Resize a reference while retaining PNG/WebP alpha and the actual encoder MIME. */
export const imageDataMimeType = (data: string, fallback = 'image/jpeg'): string =>
  /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(data)?.[1].toLowerCase() || fallback.toLowerCase();

export const compressBase64Image = async (
  rawBase64: string,
  inputMimeType: string,
  options?: { maxDimension?: number; quality?: number; fallbackToOriginal?: boolean },
): Promise<{ data: string; mimeType: string }> => {
  const sourceMime = imageDataMimeType(rawBase64, inputMimeType || 'image/jpeg');
  if (!rawBase64) return { data: '', mimeType: sourceMime };

  const maxDimension = options?.maxDimension ?? MAX_DIMENSION;
  const quality = options?.quality ?? JPEG_QUALITY;

  const dataUrl = rawBase64.startsWith('data:')
    ? rawBase64
    : `data:${sourceMime};base64,${rawBase64}`;

  try {
    const img = await loadImage(dataUrl);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > maxDimension ? maxDimension / longest : 1;
    const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
    const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    // Preserve alpha for PNG/WebP. JPEG sources remain JPEG.
    const outputMime = sourceMime === 'image/jpeg' ? 'image/jpeg' : sourceMime === 'image/webp' ? 'image/webp' : 'image/png';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataOut = canvas.toDataURL(outputMime, quality);
    const base64 = dataOut.includes('base64,') ? dataOut.split('base64,')[1] : dataOut;
    const mimeType = imageDataMimeType(dataOut, '');
    if (!mimeType || (outputMime !== 'image/jpeg' && mimeType === 'image/jpeg')) throw new Error('Encoder did not preserve transparency');
    return { data: base64, mimeType };
  } catch (err) {
    if (options?.fallbackToOriginal === false) throw err;
    console.warn('Image compression failed, sending original payload', err);
    const cleaned = rawBase64.includes('base64,') ? rawBase64.split('base64,')[1] : rawBase64;
    return { data: cleaned, mimeType: sourceMime };
  }
};
