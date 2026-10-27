/** iPhone photos arrive as HEIC/HEIF, which Chromium and WebView2 cannot
 * decode. Convert them to JPEG before the normal image pipeline; Windows often
 * reports no MIME type for them, so the extension also counts. */
const HEIC_NAME = /\.(?:heic|heif)$/i;
export const HEIC_ACCEPT = '.heic,.heif,image/heic,image/heif';

export const isHeicFile = (file: File | Blob): boolean =>
  /^image\/hei[cf](?:-sequence)?$/i.test(file.type) || ('name' in file && HEIC_NAME.test(file.name));

export async function convertHeicFile<T extends File | Blob>(file: T): Promise<T | File> {
  if (!isHeicFile(file)) return file;
  const name = 'name' in file ? file.name : 'photo.heic';
  try {
    // The decoder (libheif, ~3 MB) loads only when a HEIC photo is chosen.
    const { heicTo } = await import('heic-to/csp');
    const jpeg = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
    return new File([jpeg], name.replace(HEIC_NAME, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    throw new Error(`${name} could not be converted from HEIC. Export it as JPG and try again.`);
  }
}
