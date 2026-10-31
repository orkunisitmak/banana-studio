/** Application routes, verified against the providers' catalogues on 2026-10-20.
 * Auto selects an available route BEFORE submission, never after a paid call. */
export type AIProvider = 'openai' | 'openrouter' | 'gemini' | 'fal' | 'evolink' | 'codex';
/** Codex uses the desktop user's own ChatGPT sign-in instead of an API key. */
export type KeyedProvider = Exclude<AIProvider, 'codex'>;
export type ProviderChoice = AIProvider | 'auto';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', codex: 'ChatGPT plan (Codex)',
};
export const PROVIDER_KEYS: Record<KeyedProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY',
};
export const providerSetup = (provider: AIProvider): string => provider === 'codex'
  ? 'install the Codex CLI and run `codex login` with your ChatGPT account (desktop app only)'
  : `add your ${PROVIDER_LABELS[provider]} key in Provider keys`;
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['openai', 'openrouter', 'fal', 'codex'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'anthropic/claude-opus-5.5': ['openrouter'],
  'gpt-6.1-sol': ['openai', 'openrouter'],
  'gemini-3.8-flash': ['gemini', 'openrouter'],
  'seedance-2.0': ['evolink', 'fal', 'openrouter'],
  'seedance-2.5': ['evolink', 'fal', 'openrouter'],
  'minimax-h3': ['fal'],
};
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function sanitizeProviderAvailability(value: unknown): ProviderAvailability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sanitized: ProviderAvailability = {};
  for (const provider of Object.keys(PROVIDER_KEYS) as AIProvider[]) {
    if (typeof (value as Record<string, unknown>)[provider] === 'boolean') {
      sanitized[provider] = (value as Record<string, boolean>)[provider];
    }
  }
  return sanitized;
}
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice != null && choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) { const setup = providerSetup(choice as AIProvider); throw new Error(`${setup[0].toUpperCase()}${setup.slice(1)}, or choose Auto in AI settings.`); }
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Provider keys${routes.includes('codex') ? ' or sign in to Codex with ChatGPT' : ''}; the other keys are optional.`);
  return selected;
}

export function sanitizeProviderPreferences(value: unknown): Record<string, ProviderChoice> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sanitized: Record<string, ProviderChoice> = {};
  for (const [model, choice] of Object.entries(value)) {
    const routes = MODEL_ROUTES[model];
    if (!Array.isArray(routes)) continue;
    if (choice === 'auto') {
      sanitized[model] = 'auto';
    } else if (Array.isArray(routes) && routes.includes(choice as AIProvider)) {
      sanitized[model] = choice as ProviderChoice;
    }
  }
  return sanitized;
}

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
