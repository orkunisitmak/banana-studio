import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createServiceRoleClient, createUserScopedClient } from './auth.js';

type Provider = 'fal' | 'evolink' | 'openrouter' | 'comfyui';
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
