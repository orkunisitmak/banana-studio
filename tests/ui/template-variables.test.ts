import { describe, expect, it } from 'vitest';
import {
  applyTemplateVariables,
  extractTemplateVariables,
  missingTemplateVariables,
} from '../../src/lib/prompts/templateVariables';

describe('template variables', () => {
  it('extracts unique case-insensitive variables in first-seen order', () => {
    expect(
      extractTemplateVariables('A {{hero}} in {{ City }} with {{hero}} and {{city}}.'),
    ).toEqual(['hero', 'City']);
  });

  it('applies values and keeps unresolved placeholders visible', () => {
    expect(
      applyTemplateVariables('{{hero}} walks through {{city}}', { hero: 'Mara', city: 'Istanbul' }),
    ).toBe('Mara walks through Istanbul');
    expect(applyTemplateVariables('{{hero}} walks', {})).toBe('{{hero}} walks');
  });

  it('reports missing values without trimming issues', () => {
    expect(missingTemplateVariables('{{hero}} in {{city}}', { hero: 'Mara', city: '  ' })).toEqual(['city']);
  });
});
