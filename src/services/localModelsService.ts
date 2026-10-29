import { supabase } from './authService';
import { createTaskDeadline } from '../lib/shared/asyncTask';
import { LOCAL_CHOICE_KEYS, isLocalAssetName, isWorkflowName, type LocalChoice } from '../lib/localModels';

/** Device-level choice of installed model/workflow; empty means the server default. */
export const getLocalChoice = (key: LocalChoice): string => {
  try {
    const value = localStorage.getItem(LOCAL_CHOICE_KEYS[key]) || '';
    return (key.endsWith('Workflow') ? isWorkflowName(value) : isLocalAssetName(value)) ? value : '';
  } catch { return ''; }
};
export const setLocalChoice = (key: LocalChoice, value: string): void => {
  try { if (value) localStorage.setItem(LOCAL_CHOICE_KEYS[key], value); else localStorage.removeItem(LOCAL_CHOICE_KEYS[key]); } catch { /* Best effort. */ }
};

const request = async (query: string, signal?: AbortSignal) => {
  const { data } = await supabase.auth.getSession();
  // createTaskDeadline instead of AbortSignal.any, which older Safari versions lack.
  const task = createTaskDeadline(10_000, signal, 'The local server did not answer in time.');
  let response: Response, body: any;
  try {
    response = await fetch(`/api/local-models?${query}`, { cache: 'no-store', signal: task.signal,
      headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
    body = await response.json().catch(() => null);
  } finally { task.dispose(); }
  if (!response.ok) throw new Error(body?.error || 'The local server could not be reached.');
  return body;
};
export type LocalModelList = { models: string[]; workflows?: string[]; workflowsDir?: string };
export const listLocalModels = (server: 'sdwebui' | 'comfyui' | 'openaicompat', signal?: AbortSignal): Promise<LocalModelList> =>
  request(`server=${server}`, signal);
/** null = not configured, false = configured but not answering. */
export const getLocalServerStatus = (signal?: AbortSignal): Promise<Record<string, boolean | null>> =>
  request('status=1', signal).then(body => body?.servers || {});
