import { supabase } from './authService';
import { createTaskDeadline } from '../lib/shared/asyncTask';

export type OllamaModels = { models: string[]; defaultModel: string | null };

/** Lists models installed on the workspace's Ollama server. Nothing is generated or billed. */
export async function listOllamaModels(signal?: AbortSignal, provider: 'ollama' | 'openaicompat' = 'ollama'): Promise<OllamaModels> {
  const { data } = await supabase.auth.getSession();
  // createTaskDeadline instead of AbortSignal.any, which older Safari versions lack.
  const task = createTaskDeadline(10_000, signal, 'The local model list timed out.');
  let response: Response, body: any;
  try {
    response = await fetch(`/api/ollama-text-generate?provider=${provider}`, { cache: 'no-store', signal: task.signal,
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
    body = await response.json().catch(() => null);
  } finally { task.dispose(); }
  if (!response.ok) throw new Error(body?.error || 'Ollama models could not be listed.');
  return { models: Array.isArray(body?.models) ? body.models : [], defaultModel: body?.defaultModel ?? null };
}
