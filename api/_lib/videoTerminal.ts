import type { VercelResponse } from '@vercel/node';
import type { prepareTaskRegistry } from './providerTasks.js';

/** Only provider-confirmed terminal states reach this helper. Optional bookkeeping
 * must not hide the provider error, erase a completion or overwrite newer metadata. */
export async function persistFalFailure(registry: typeof prepareTaskRegistry, owner: string, taskId: string, state: string, error: string, actualCostUsd: number | undefined, legacyH3 = false): Promise<void> {
  try {
    const silent = { status: () => silent, json: () => silent } as unknown as VercelResponse;
    const db = await registry(silent);
    if (!db) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const {data: row, error: readError} = await db.from('generations').select('id,status,metadata')
        .eq('task_id', taskId).eq('user_id', owner).eq('type', 'video').maybeSingle();
      if (readError || !row || row.status === 'completed') return;
      const prefix = legacyH3 ? 'h3' : 'fal';
      const metadata = { ...row.metadata, error, [prefix+'TerminalState']:state, [prefix+'TerminalDetectedAt']:new Date().toISOString(),
        ...(actualCostUsd !== undefined ? {generationCost:{usd:actualCostUsd,source:'provider_actual'}} : {}) };
      let update = db.from('generations').update({status:'failed',metadata})
        .eq('id',row.id).eq('user_id',owner).eq('type','video').eq('task_id',taskId).eq('status',row.status);
      update = row.metadata == null ? update.is('metadata',null) : update.eq('metadata',JSON.stringify(row.metadata));
      const saved = await update.select('id').maybeSingle();
      if (saved.error || saved.data) return;
    }
  } catch { console.warn('Confirmed video failure could not be saved', taskId); }
}
