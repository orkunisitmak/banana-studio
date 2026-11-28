const noTextSuffix = 'No text, no letters, no words, no numbers, no captions, no logos-with-words, no typography, no watermark anywhere in the image.';

export const buildBrainstormTextInstruction = (noText?: boolean): string => noText
  ? `IMAGE TEXT POLICY: Convey every idea visually. This overrides requests for visible text, including titles, prices, ratings and reference-image lettering. ${noTextSuffix}` : '';

/** Idempotent so both idea preparation and final batch dispatch can enforce it. */
export function applyBrainstormTextPolicy(prompt: string, noText?: boolean): string {
  if (!noText) return prompt;
  const scene = prompt.split(noTextSuffix).join('').trimEnd();
  return scene ? `${scene}\n\n${noTextSuffix}` : noTextSuffix;
}
