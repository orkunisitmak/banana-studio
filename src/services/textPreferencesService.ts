import { getSession, supabase } from './authService';
import { createTaskDeadline, waitForTask } from '../lib/shared/asyncTask';
import { configureTextModelPreferences, GEMINI_THINKING_LEVELS, resolveTextModelPreferences, TEXT_FEATURES, type TextModelPreferences } from '../lib/prompts/textModels';
import { TEXT_MODEL_OPTIONS } from '../types';
import { isOpenAIReasoningEffort } from '../lib/prompts/openaiText';

export type SavedTextPreferences = TextModelPreferences & { source: 'personal' | 'all'; revision: number; canSaveAll: boolean };
export type TextPreferenceScope = 'me' | 'all';

async function requestPreferences(scope?: TextPreferenceScope, preferences?: TextModelPreferences, expectedUserId?: string): Promise<SavedTextPreferences> {
  const task = createTaskDeadline(10_000, undefined, 'Model settings could not be loaded. Please try again.');
  try {
    const session = await waitForTask(getSession(), task.signal);
    if (!session || (expectedUserId && session.user.id !== expectedUserId)) throw new Error('Session changed. Please sign in again.');
    const { data, error } = await waitForTask(scope
      ? supabase.rpc('save_text_model_preferences', { p_expected_user_id: session.user.id, p_scope: scope, p_model: preferences?.model,
        p_gemini_thinking: preferences?.thinkingLevel, p_openai_reasoning: preferences?.reasoningEffort, p_feature_models: preferences?.featureModels }).abortSignal(task.signal)
      : supabase.rpc('get_text_model_preferences').abortSignal(task.signal), task.signal);
    if (error) throw new Error(error.code === '42501' ? 'You do not have permission to save these settings.' : 'Model settings are unavailable. Please try again.');
    const current = await waitForTask(getSession(), task.signal);
    if (current?.user.id !== session.user.id) throw new Error('Session changed. Please try again.');
    if (!data || !TEXT_MODEL_OPTIONS.some(option => option.value === data.model)
      || !data.featureModels || typeof data.featureModels !== 'object' || Array.isArray(data.featureModels)
      || Object.entries(data.featureModels).some(([key, model]) => !TEXT_FEATURES.some(feature => feature === key) || !TEXT_MODEL_OPTIONS.some(option => option.value === model))
      || !GEMINI_THINKING_LEVELS.includes(data.thinkingLevel) || !isOpenAIReasoningEffort(data.reasoningEffort)
      || !['personal', 'all'].includes(data.source) || typeof data.canSaveAll !== 'boolean'
      || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Invalid model settings response. Please try again.');
    return data as SavedTextPreferences;
  } finally { task.dispose(); }
}

export const loadTextPreferences = () => requestPreferences();
export const saveTextPreferences = (scope: TextPreferenceScope, preferences: TextModelPreferences) => requestPreferences(scope, preferences);

/** Every new creative task reads the server before capturing its immutable settings. */
export const startTextPreferencesSync = (userId: string): (() => void) => {
  const stop = configureTextModelPreferences(() => requestPreferences(undefined, undefined, userId));
  void Promise.resolve(resolveTextModelPreferences()).catch(() => { /* The next action or Settings surfaces a retryable error. */ });
  return stop;
};
