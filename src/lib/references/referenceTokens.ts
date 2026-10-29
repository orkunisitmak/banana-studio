import type { ReferenceImage } from '../../types.js';

// Quoted visible copy is literal, even when it looks like a reference.
export const mapUnquotedPrompt = (prompt: string, map: (text: string) => string): string => {
  const quotes = /"[^"\n]*"|“[^”\n]*”|(?<!\w)'[^'\n]*'(?!\w)/g;
  let end = 0, result = '';
  for (const match of prompt.matchAll(quotes)) {
    result += map(prompt.slice(end, match.index)) + match[0];
    end = match.index! + match[0].length;
  }
  return result + map(prompt.slice(end));
};

export const getStableImageTag = (id: string): string => `@REFERENCE[${encodeURIComponent(id)}]`;

/** Bind positional UI mentions before references can be inserted or removed. */
export const bindImageReferences = (prompt: string, references: ReferenceImage[], tag = (ref: ReferenceImage) => getStableImageTag(ref.id)): string =>
  mapUnquotedPrompt(prompt, text => text.replace(/@REF_IMAGE_(\d+)\b/gi, (token, number) => {
    const ref = references[Number(number) - 1];
    return ref ? tag(ref) : token;
  }));

/** Resolve stable image IDs against the actual submission order, never by name. */
export const resolveStableImageReferences = (prompt: string, inputs: ReferenceImage[]): string =>
  mapUnquotedPrompt(prompt, text => text.replace(/@REFERENCE\[([^\]\n]*)\]|@MISSING_IMAGE_(\d+)\b/gi, (token, encodedId) => {
    let id: string | undefined;
    try { id = encodedId == null ? undefined : decodeURIComponent(encodedId); } catch { /* invalid token stays unresolved */ }
    const index = id == null ? -1 : inputs.findIndex(ref => ref.id === id);
    if (index < 0) throw new Error('An image reference in the prompt is no longer attached or its match was lost. Remove that tag and choose the reference again from the @ menu.');
    return `image ${index + 1}`;
  }));
