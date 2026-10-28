const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_ -]{0,39})\s*\}\}/g;

/** Variables are case-insensitive and preserve the first spelling used. */
export const extractTemplateVariables = (prompt: string): string[] => {
  const seen = new Set<string>();
  const variables: string[] = [];
  for (const match of prompt.matchAll(VARIABLE_PATTERN)) {
    const name = match[1].trim().replace(/\s+/g, ' ');
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variables.push(name);
  }
  return variables;
};

export const hasTemplateVariables = (prompt: string): boolean =>
  extractTemplateVariables(prompt).length > 0;

/** Leaves unresolved placeholders intact so a half-filled template is visible. */
export const applyTemplateVariables = (prompt: string, values: Record<string, string>): string => {
  const byKey = new Map(Object.entries(values).map(([key, value]) => [key.toLocaleLowerCase(), value.trim()]));
  return prompt.replace(VARIABLE_PATTERN, (placeholder, rawName: string) => {
    const name = rawName.trim().replace(/\s+/g, ' ');
    return byKey.get(name.toLocaleLowerCase()) || placeholder;
  });
};

export const missingTemplateVariables = (prompt: string, values: Record<string, string>): string[] =>
  extractTemplateVariables(prompt).filter(name => !values[name]?.trim());
