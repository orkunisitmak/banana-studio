import { createServiceRoleClient } from './auth.js';
import { createTaskDeadline, waitForTask } from '../../src/lib/shared/asyncTask.js';

export interface UsageRecord {
  action: 'enhance' | 'video_enhance' | 'brainstorm' | 'variation' | 'video_generate';
  model: string; prompt: string; imageCount: number; estimatedCost: number | null;
}

/** Members cannot insert usage_logs. Each paid route records its own row with a
 * server-computed cost once the provider has answered or accepted the request.
 * Never throws: accounting must not turn a billed provider result into an error. */
export async function recordUsage(userId: string, row: UsageRecord): Promise<{ usageLogged: boolean; usageLoggingPending: boolean }> {
  const cost = typeof row.estimatedCost === 'number' && Number.isFinite(row.estimatedCost) && row.estimatedCost >= 0 ? row.estimatedCost : null;
  const accounting = createTaskDeadline(5_000);
  try {
    const db = createServiceRoleClient();
    if (!db) throw new Error('Usage storage is unavailable.');
    const { error } = await waitForTask(db.from('usage_logs').insert({
      user_id: userId, action: row.action, model: row.model, prompt: row.prompt.slice(0, 500), image_count: row.imageCount, estimated_cost: cost,
    }).abortSignal(accounting.signal), accounting.signal);
    if (error) console.warn(`[usage] action=${row.action} model=${row.model} stage=unrecorded`);
    return { usageLogged: !error, usageLoggingPending: false };
  } catch (error: any) {
    // A timed-out write may still commit. It is never submitted a second time.
    const pending = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    console.warn(`[usage] action=${row.action} model=${row.model} stage=${pending ? 'unconfirmed' : 'unrecorded'}`);
    return { usageLogged: false, usageLoggingPending: pending };
  } finally { accounting.dispose(); }
}
