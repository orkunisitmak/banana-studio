/** JSON Schema maxLength counts Unicode code points, not UTF-16 code units. */
export function exceedsCharacterLimit(text: string, max: number): boolean {
  if (text.length <= max) return false;
  if (text.length > 2 * max) return true;
  let count = 0;
  for (const _ of text) if (++count > max) return true;
  return false;
}
