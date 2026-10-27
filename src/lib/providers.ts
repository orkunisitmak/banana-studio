/** Application routes, verified against the providers' catalogues on 2026-10-20.
 * Auto selects an available route BEFORE submission, never after a paid call. */
export type AIProvider = 'openai' | 'openrouter' | 'gemini' | 'fal' | 'evolink' | 'comfyui';
export type ProviderChoice = AIProvider | 'auto';
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI', openrouter: 'OpenRouter', gemini: 'Google Gemini', fal: 'fal.ai', evolink: 'EvoLink', comfyui: 'Local ComfyUI',
};
export const PROVIDER_KEYS: Record<AIProvider, string> = {
  openai: 'OPENAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', evolink: 'EVOLINK_API_KEY',
  // Not a secret: the server-side address of a ComfyUI instance the owner runs.
  comfyui: 'COMFYUI_URL',
};
export const MODEL_ROUTES: Record<string, readonly AIProvider[]> = {
  'gpt-image-2.5-sunburst': ['openai', 'openrouter', 'fal'],
  'gemini-3-pro-image-preview': ['fal', 'gemini', 'openrouter'],
  'gemini-nano-banana-2.1': ['fal', 'gemini', 'openrouter'],
  'flux2-klein-local': ['comfyui'],
  'flux3-klein-local': ['comfyui'],
  'anthropic/claude-opus-5.5': ['openrouter'],
  'gpt-6.1-sol': ['openai', 'openrouter'],
  'gemini-3.8-flash': ['gemini', 'openrouter'],
  'seedance-2.0': ['evolink', 'fal', 'openrouter'],
  'seedance-2.5': ['evolink', 'fal', 'openrouter'],
  'minimax-h3': ['fal'],
};
// COMFYUI_URL is read from the server environment; the native Provider keys
// dialogs have no field for it yet, so this message must not send users there.
const LOCAL_SETUP = 'Start ComfyUI and set COMFYUI_URL (for example http://127.0.0.1:8188) in the server environment to use the local model. It is an address, not a provider key; the desktop Provider keys dialogs do not list it yet.';
export type ProviderAvailability = Partial<Record<AIProvider, boolean>>;
export function resolveProvider(model: string, choice: unknown, available: ProviderAvailability): AIProvider {
  const routes = MODEL_ROUTES[model];
  if (!Array.isArray(routes)) throw new Error('Unsupported model.');
  if (choice != null && choice !== 'auto') {
    if (!routes.includes(choice as AIProvider)) throw new Error('This provider does not serve the selected model.');
    if (!available[choice as AIProvider]) throw new Error(choice === 'comfyui' ? LOCAL_SETUP : `Add your ${PROVIDER_LABELS[choice as AIProvider]} key in Provider keys, or choose Auto in AI settings.`);
    return choice as AIProvider;
  }
  const selected = routes.find(provider => available[provider]);
  if (!selected && routes.length === 1 && routes[0] === 'comfyui') throw new Error(LOCAL_SETUP);
  if (!selected) throw new Error(`This model needs ${routes.map(provider => PROVIDER_LABELS[provider]).join(' or ')}. Add one key in Provider keys; the other keys are optional.`);
  return selected;
}

/** A draft whose image model has no configured provider starts on the local
 * FLUX 3 model when ComfyUI is set up, instead of a model that cannot run. */
export const startingImageModel = (model: string, available: ProviderAvailability): string =>
  !MODEL_ROUTES[model]?.some(provider => available[provider]) && available.comfyui ? 'flux3-klein-local' : model;

export const OPENROUTER_MODELS: Record<string, string> = {
  'gpt-image-2.5-sunburst': 'openai/gpt-image-2.5-sunburst',
  'gemini-3-pro-image-preview': 'google/gemini-3-pro-image',
  'gemini-nano-banana-2.1': 'google/gemini-nano-banana-2.1',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol', 'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'seedance-2.0': 'bytedance/seedance-2.0', 'seedance-2.5': 'bytedance/seedance-2.5',
};
