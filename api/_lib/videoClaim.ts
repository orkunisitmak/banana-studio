import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelResponse } from '@vercel/node';

/** A lost submit response must not turn a second POST into a second charge.
 * Keep provider identity even if the browser closes before receiving the ID. */
export async function claimVideo(db: SupabaseClient, res: VercelResponse, id: string, owner: string, routing: Record<string, string>): Promise<boolean> {
  const { data: row, error } = await db.from('generations').select('metadata,status,task_id').eq('id', id).eq('user_id', owner).eq('type', 'video').maybeSingle();
  if (error) { res.status(503).json({ error: 'Could not read the saved video. No provider request was sent.' }); return false; }
  if (!row || row.status !== 'pending' || row.task_id) { res.status(409).json({ code: 'GENERATION_SUBMITTING', error: 'Check the existing video task before submitting again.' }); return false; }
  if ((row.metadata?.generationProvider && row.metadata.generationProvider !== routing.generationProvider) || (row.metadata?.videoModel && row.metadata.videoModel !== routing.videoModel)) {
    res.status(409).json({error:'The saved video belongs to a different model or provider. No provider request was sent.'}); return false;
  }
  let claim = db.from('generations').update({ status: 'processing', metadata: { ...row.metadata, ...routing } }).eq('id', id).eq('user_id', owner).eq('type', 'video').eq('status', 'pending');
  claim = row.task_id == null ? claim.is('task_id', null) : claim.eq('task_id', row.task_id);
  claim = row.metadata == null ? claim.is('metadata', null) : claim.eq('metadata', JSON.stringify(row.metadata));
  const saved = await claim.select('id').maybeSingle();
  if (saved.error || !saved.data) {
    res.status(saved.error ? 503 : 409).json(saved.error ? {error:'Could not claim the saved video. No provider request was sent.'} : {code:'GENERATION_SUBMITTING',error:'The saved video changed. Check its task history before submitting again.'}); return false;
  }
  return true;
}

/** A definite 4xx rejection can settle the claimed row; a timeout cannot. */
export async function rejectVideoClaim(db: SupabaseClient, generationId: string | undefined, owner: string, httpStatus: number): Promise<void> {
  if (!generationId || httpStatus < 400 || httpStatus >= 500 || httpStatus === 408) return;
  try {
    const row = await db.from('generations').select('task_id').eq('id', generationId).eq('user_id', owner).eq('status', 'processing').maybeSingle();
    if (row.error || !row.data || row.data.task_id) return;
    const change = db.from('generations').update({ status: 'failed' }).eq('id', generationId).eq('user_id', owner).eq('type', 'video').eq('status', 'processing');
    await (row.data.task_id == null ? change.is('task_id', null) : change.eq('task_id', ''));
  } catch { /* Bookkeeping must not hide the original provider rejection. */ }
}
