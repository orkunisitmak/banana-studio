/** Read encoded dimensions without decoding/re-encoding the generated image. */
export const readImageDimensions = (bytes: Buffer): string | undefined => {
  const size = (width: number, height: number) => width > 0 && height > 0 ? `${width}x${height}` : undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return size(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (length > bytes.length - start) return undefined;
      if (kind === 'VP8X' && length >= 10) return size(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3));
      if (kind === 'VP8 ' && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) {
        return size(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
      }
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = bytes.readUInt32LE(start + 1);
        return size(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
      }
      offset = start + length + (length % 2);
    }
  }
  if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return size(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) return undefined;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset >= bytes.length) return undefined;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return undefined; // End of headers.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return undefined;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || length > bytes.length - offset) return undefined;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return length >= 7 ? size(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)) : undefined;
      }
      offset += length;
    }
  }
  // GPT Image 2.6 SVG output: read the root element's pixel width/height or viewBox.
  const head = bytes.subarray(0, 4096).toString('utf8');
  const root = head.match(/<svg\b[^>]*>/i)?.[0];
  if (root) {
    const attribute = (name: string) => root.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i'))?.[1];
    const width = Number(attribute('width')), height = Number(attribute('height'));
    if (width > 0 && height > 0) return size(Math.round(width), Math.round(height));
    const box = root.match(/\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    if (box) return size(Math.round(Number(box[1])), Math.round(Number(box[2])));
  }
  return undefined;
};
