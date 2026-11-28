/** Only one canonical public video URI can opt a Hydrogen request into the native footage route. */
export function hasYouTubeFootage(contents: unknown): boolean {
  let found = false;
  for (const message of Array.isArray(contents) ? contents : [contents]) {
    if (!Array.isArray(message?.parts)) continue;
    for (const part of message.parts) {
      if (!part?.fileData) continue;
      const uri = part.fileData.fileUri;
      if (found || typeof uri !== 'string' || !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(uri)) return false;
      found = true;
    }
  }
  return found;
}
