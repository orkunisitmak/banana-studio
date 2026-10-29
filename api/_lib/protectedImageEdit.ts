import { decodeRaster as decode, encodeRasterPNG } from './rasterCodec.js';
import { editRegionPixels, type ImageEditRegion } from '../../src/lib/images/imageEditRegion.js';
import { imageSha256 } from './imageStorage.js';
import { compositeEditPixels } from '../../src/lib/images/imageEditPixels.js';
import { resizePixels } from '../../src/lib/images/resizePixels.js';

const MAX_BYTES = 50 * 1024 * 1024;

/** Read through the caller's RLS-scoped Storage client, never fetch arbitrary URLs. */
export const readEditSource = async (db: any, url: string, userId: string) => {
  const project = new URL(process.env.SUPABASE_URL || '');
  const source = new URL(url);
  const match = source.pathname.match(/^\/storage\/v1\/object\/(?:sign|authenticated|public)\/media\/(.+)$/);
  const path = match ? decodeURIComponent(match[1]) : '';
  if (source.origin !== project.origin || path.split('/').some(part => !part || part === '.' || part === '..')
    || !(path.startsWith(`${userId}/`) || path.startsWith(`openai/${userId}/`))) {
    throw new Error('Edit source must be an image uploaded to your account. Attach it again.');
  }
  const { data, error } = await db.storage.from('media').download(path);
  if (error || !data || data.size > MAX_BYTES) throw new Error('Edit source could not be read. Attach it again before generating.');
  const bytes = Buffer.from(await data.arrayBuffer());
  const decoded = await decode(bytes);
  return { ...decoded, sha256: imageSha256(bytes) };
};

/** White = repaint, black = keep. Same rasterization and inward feather as the compositor. */
export const editMaskPNG = async (region: ImageEditRegion, width: number, height: number): Promise<Buffer> => {
  const black = new Uint8Array(width * height * 4), white = new Uint8Array(width * height * 4).fill(255);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  return Buffer.from(await encodeRasterPNG(compositeEditPixels(black, white, width, height, region), width, height));
};

/** The model may redraw the full canvas. Accept only its selected area.
 * Blend a narrow border INSIDE the selection; outside pixels are never touched. */
export const compositeProtectedEdit = async (
  source: Awaited<ReturnType<typeof readEditSource>>, generated: Buffer, region: ImageEditRegion, allowTierResize = false,
) => {
  const output = await decode(generated);
  const { width, height } = source.info;
  const differentSize = output.info.width !== width || output.info.height !== height;
  const sameRatio = Math.abs(output.info.width / output.info.height - width / height) / (width / height) <= .01;
  if (differentSize && (!allowTierResize || !sameRatio)) {
    throw new Error('The provider returned a different canvas size. The protected edit was not saved; check usage before retrying.');
  }
  const bounds = editRegionPixels(region, width, height);
  const generatedPixels = differentSize ? resizePixels(output.data, output.info.width, output.info.height, width, height) : output.data;
  const pixels = compositeEditPixels(source.data, generatedPixels, width, height, region);
  const bytes = await encodeRasterPNG(pixels, width, height);
  return { bytes, bounds };
};
