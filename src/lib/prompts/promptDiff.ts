export type DiffPart = { type: 'same' | 'added' | 'removed'; text: string };

/** Word-level LCS diff for Enhance review. Long prompts fall back to a whole replacement to stay fast. */
export const diffPrompts = (before: string, after: string, limit = 1500): DiffPart[] => {
  const a = before.split(/(\s+)/).filter(Boolean), b = after.split(/(\s+)/).filter(Boolean);
  if (before === after) return before ? [{ type: 'same', text: before }] : [];
  if (a.length > limit || b.length > limit) return [...(before ? [{ type: 'removed' as const, text: before }] : []), ...(after ? [{ type: 'added' as const, text: after }] : [])];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last?.type === type) last.text += text; else parts.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) push('removed', a[i++]);
    else push('added', b[j++]);
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return parts;
};
