/** Application routes, verified against the providers' catalogues on 2026-10-20.
 * Auto selects an available route BEFORE submission, never after a paid call. */
export type AIProvider = 'openai' | 'openrouter' | 'gemini' | 'fal' | 'evolink' | 'claude' | 'codex';
/** Codex uses the desktop user's own ChatGPT sign-in instead of an API key.
 * Claude uses a desktop user's own Claude plan token from `claude setup-token`. */
export type KeyedProvider = Exclude<AIProvider, 'codex'>;
export type ProviderChoice = AIProvider | 'auto';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', claude: 'Claude plan (Agent SDK)', codex: 'ChatGPT plan (Codex)',
};
export const PROVIDER_KEYS: Record<KeyedProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY', claude: 'CLAUDE_CODE_OAUTH_TOKEN',
};
export const providerSetup = (provider: AIProvider): string => provider === 'codex'
  ? 'install the Codex CLI and run `codex login` with your ChatGPT account (desktop app only)'
  : provider === 'claude' ? 'run `claude setup-token` and paste the token as Claude plan in Provider keys (desktop app only)'
  : `add your ${PROVIDER_LABELS[provider]} key in Provider keys`;
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['openai', 'openrouter', 'fal', 'codex'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'anthropic/claude-opus-5.5': ['openrouter', 'claude'],
  'gpt-6.1-sol': ['openai', 'openrouter'],
  'gemini-3.8-flash': ['gemini', 'openrouter'],
  'seedance-2.0': ['evolink', 'fal', 'openrouter'],
  'seedance-2.5': ['evolink', 'fal', 'openrouter'],
  'minimax-h3': ['fal'],
};
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice != null && choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) { const setup = providerSetup(choice as AIProvider); throw new Error(`${setup[0].toUpperCase()}${setup.slice(1)}, or choose Auto in AI settings.`); }
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Provider keys${routes.includes('codex') ? ' or sign in to Codex with ChatGPT' : ''}${routes.includes('claude') ? ' or add a Claude plan token' : ''}; the other keys are optional.`);
  return selected;
}

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
