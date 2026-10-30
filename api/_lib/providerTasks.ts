import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceRoleClient, createUserScopedClient } from './auth.js';

type Provider = 'fal' | 'evolink' | 'openrouter';
type RegistryWriter = NonNullable<ReturnType<typeof createServiceRoleClient>>;

/** Fail before charging a provider if durable, server-owned tracking is unavailable. */
export async function prepareTaskRegistry(res: VercelResponse): Promise<RegistryWriter | null> {
  const writer = createServiceRoleClient();
  if (!writer) {
    res.status(503).json({ error: 'Private task tracking is not configured. Contact an administrator.' });
    return null;
  }
  try {
    const { error } = await writer.from('provider_tasks').select('task_id').limit(0);
    if (error) throw error;
    return writer;
  } catch {
    res.status(503).json({ error: 'Private task tracking is unavailable. No generation request was sent.' });
    return null;
  }
}

export async function registerProviderTask(writer: RegistryWriter, provider: Provider, taskId: string, userId: string): Promise<void> {
  const { error } = await writer.from('provider_tasks').insert({ provider, task_id: taskId, user_id: userId });
  if (error) {
    // Do not overwrite an existing association or automatically resubmit a
    // billable task. The ID lets an admin inspect the provider after a DB outage.
    throw new Error(`Generation was submitted but its private task could not be recorded (Task: ${taskId}). Contact an administrator before retrying.`);
  }
}

export const isGenerationId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);

/** Save the accepted task on the caller's own gallery row, so a reload can
 * resume it. The browser must not be the only durable copy of a paid task ID. */
/** A billable submission for a saved video goes out only while that row exists and is the caller's. */
export async function requireSavedVideo(reader: RegistryWriter, res: VercelResponse, generationId: string, userId: string): Promise<boolean> {
  const { data, error } = await reader.from('generations').select('id,type')
    .eq('id', generationId).eq('user_id', userId).maybeSingle();
  if (error) { res.status(503).json({ error: 'The saved video could not be checked. No provider request was sent.' }); return false; }
  if (!data || data.type !== 'video') { res.status(404).json({ error: 'The saved video no longer exists. No provider request was sent.' }); return false; }
  return true;
}

export async function saveGenerationTask(writer: RegistryWriter, generationId: string, userId: string, taskId: string): Promise<boolean> {
  const { data, error } = await writer.from('generations').update({ task_id: taskId })
    .eq('id', generationId).eq('user_id', userId).select('id').maybeSingle();
  return !error && !!data;
}

/**
 * RLS grants SELECT only to the owner or an active administrator. The registry
 * has no client write grants; editable generation metadata is never proof of
 * ownership, because an attacker could copy a foreign task ID into their row.
 */
export async function requireProviderTask(req: VercelRequest, res: VercelResponse, provider: Provider, taskId: unknown): Promise<boolean> {
  if (typeof taskId !== 'string' || !taskId || taskId.length > 200) {
    res.status(400).json({ error: 'A valid task ID is required' });
    return false;
  }
  try {
    const { data, error } = await createUserScopedClient(req).from('provider_tasks')
      .select('task_id').eq('provider', provider).eq('task_id', taskId).maybeSingle();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Task not found' });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'Task access could not be verified. Try again shortly.' });
    return false;
  }
}
