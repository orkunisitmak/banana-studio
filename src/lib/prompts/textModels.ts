import { DEFAULT_TEXT_MODEL, TEXT_MODEL_OPTIONS, type TextModelId } from '../../types';
import { DEFAULT_OPENAI_REASONING, isOpenAIReasoningEffort, type OpenAIReasoningEffort } from './openaiText.js';
import { DEFAULT_OPENROUTER_REASONING, OPENROUTER_TEXT_MODEL, OPENROUTER_FREE_TEXT_MODEL } from './openrouterText.js';

export { OPENAI_TEXT_MODEL, calculateOpenAITextCost } from './openaiText.js';
export { OPENROUTER_TEXT_MODEL, OPENROUTER_FREE_TEXT_MODEL, calculateOpenRouterTextCost } from './openrouterText.js';
export const GEMINI_THINKING_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type GeminiThinkingLevel = typeof GEMINI_THINKING_LEVELS[number];
export const DEFAULT_GEMINI_THINKING: GeminiThinkingLevel = 'MEDIUM';
export type TextModelPreferences = { model: TextModelId; thinkingLevel: GeminiThinkingLevel; reasoningEffort: OpenAIReasoningEffort };
const defaultPreferences = (): TextModelPreferences => ({ model: DEFAULT_TEXT_MODEL, thinkingLevel: DEFAULT_GEMINI_THINKING, reasoningEffort: DEFAULT_OPENROUTER_REASONING });
let accountPreferences: TextModelPreferences | null = null;
let preferenceLoader: (() => Promise<TextModelPreferences>) | null = null;

/** The authorized workspace installs an account-bound loader; old browser values never cross accounts. */
export const configureTextModelPreferences = (loader: () => Promise<TextModelPreferences>): (() => void) => {
  preferenceLoader = loader;
  accountPreferences = defaultPreferences();
  return () => { if (preferenceLoader === loader) { preferenceLoader = null; accountPreferences = null; } };
};
export const resolveTextModelPreferences = (): TextModelPreferences | Promise<TextModelPreferences> => {
  if (!preferenceLoader) return { model: getTextModel(), thinkingLevel: getGeminiThinkingLevel(), reasoningEffort: getOpenAIReasoningEffort() };
  const loader = preferenceLoader;
  return loader().then(value => {
    if (preferenceLoader !== loader) throw new Error('Session changed. Please try again.');
    accountPreferences = { ...value };
    return { ...value };
  });
};
const GEMINI_THINKING_STORAGE_KEY = 'nanogen-gemini-thinking';
export const getGeminiThinkingLevel = (): GeminiThinkingLevel => {
  if (accountPreferences) return accountPreferences.thinkingLevel;
  try {
    const value = localStorage.getItem(GEMINI_THINKING_STORAGE_KEY);
    if (GEMINI_THINKING_LEVELS.includes(value as GeminiThinkingLevel)) return value as GeminiThinkingLevel;
  } catch { /* Storage may be unavailable. */ }
  return DEFAULT_GEMINI_THINKING;
};
export const setGeminiThinkingLevel = (value: GeminiThinkingLevel): void => {
  if (!GEMINI_THINKING_LEVELS.includes(value)) return;
  try { localStorage.setItem(GEMINI_THINKING_STORAGE_KEY, value); } catch { /* Best effort. */ }
};
const TEXT_MODEL_STORAGE_KEY = 'nanogen-text-model';
const isTextModel = (model: unknown): model is TextModelId => TEXT_MODEL_OPTIONS.some(option => option.value === model);

export const getTextModel = (): TextModelId => {
  if (accountPreferences) return accountPreferences.model;
  try {
    const stored = localStorage.getItem(TEXT_MODEL_STORAGE_KEY);
    if (isTextModel(stored)) return stored;
    if (stored) localStorage.setItem(TEXT_MODEL_STORAGE_KEY, DEFAULT_TEXT_MODEL);
  } catch { /* Storage may be unavailable; use the default. */ }
  return DEFAULT_TEXT_MODEL;
};

export const setTextModel = (model: TextModelId): void => {
  if (!isTextModel(model)) return;
  try { localStorage.setItem(TEXT_MODEL_STORAGE_KEY, model); } catch { /* Best effort. */ }
};

const OPENAI_REASONING_STORAGE_KEY = 'nanogen-openai-reasoning';
export const getOpenAIReasoningEffort = (): OpenAIReasoningEffort => {
  if (accountPreferences) return accountPreferences.reasoningEffort;
  try {
    const value = localStorage.getItem(OPENAI_REASONING_STORAGE_KEY);
    if (isOpenAIReasoningEffort(value)) return value;
  } catch { /* Storage may be unavailable. */ }
  return (getTextModel() === OPENROUTER_TEXT_MODEL || getTextModel() === OPENROUTER_FREE_TEXT_MODEL) ? DEFAULT_OPENROUTER_REASONING : DEFAULT_OPENAI_REASONING;
};
export const setOpenAIReasoningEffort = (value: OpenAIReasoningEffort): void => {
  if (!isOpenAIReasoningEffort(value)) return;
  try { localStorage.setItem(OPENAI_REASONING_STORAGE_KEY, value); } catch { /* Best effort. */ }
};
