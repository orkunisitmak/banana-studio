import type { PromptPreparation } from '../../types.js';
import { OPENAI_TEXT_MODEL, isOpenAIReasoningEffort } from './openaiText.js';
import { OPENROUTER_TEXT_MODEL } from './openrouterText.js';
import { OLLAMA_TEXT_MODEL } from './ollamaText.js';

/** Keep only recorded task data. Never fill historical gaps with today's preferences. */
export const normalizePromptPreparation = (value: unknown): PromptPreparation | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.action !== 'string' || !['enhance', 'brainstorm', 'variation'].includes(record.action)
    || typeof record.model !== 'string' || !record.model.trim() || record.model.length > 120) return undefined;
  const result: PromptPreparation = { action: record.action as PromptPreparation['action'], model: record.model.trim() };
  const reasoningModel = result.model === OPENAI_TEXT_MODEL || result.model === OPENROUTER_TEXT_MODEL;
  if (reasoningModel && isOpenAIReasoningEffort(record.reasoningEffort)) result.reasoningEffort = record.reasoningEffort;
  if (!reasoningModel && result.model !== OLLAMA_TEXT_MODEL && typeof record.thinkingLevel === 'string' && ['LOW', 'MEDIUM', 'HIGH'].includes(record.thinkingLevel)) {
    result.thinkingLevel = record.thinkingLevel as PromptPreparation['thinkingLevel'];
  }
  return result;
};

export const createPromptPreparation = (
  action: PromptPreparation['action'],
  options: { model?: string; reasoningEffort?: unknown; thinkingLevel?: unknown },
): PromptPreparation | undefined => normalizePromptPreparation({ action, ...options });
