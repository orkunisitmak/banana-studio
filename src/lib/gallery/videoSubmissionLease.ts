import type { SupabaseClient } from '@supabase/supabase-js';
import { STUCK_PENDING_MS, VIDEO_SUBMISSION_LEASE_MS } from './stuckPending';

type GenerationDatabase = Pick<SupabaseClient, 'from'>;

/**
 * The submitting client periodically renews this lease while waiting for a
 * provider task ID. Updates are conditional on the row still being pending,
 * so an in-flight heartbeat cannot overwrite a completed/processing result.
 */
export const refreshPendingVideoSubmission = async (
  db: GenerationDatabase,
  userId: string,
  id: string,
  now = Date.now(),
): Promise<boolean> => {
  const { data: current, error: readError } = await db.from('generations')
    .select('metadata').eq('id', id).eq('user_id', userId)
    .eq('type', 'video').eq('status', 'pending').eq('task_id', '').maybeSingle();
  if (readError || !current) return false;
  const previous = Number(current.metadata?.submissionHeartbeatAt);
  if (Number.isFinite(previous) && previous >= now) return true;

  let query = db.from('generations')
    .update({ metadata: { ...(current.metadata || {}), submissionHeartbeatAt: now } })
    .eq('id', id).eq('user_id', userId)
    .eq('type', 'video').eq('status', 'pending').eq('task_id', '');
  // Compare-and-set: a slow renewal cannot rewind a newer heartbeat.
  query = Number.isFinite(previous) && previous > 0
    ? query.eq('metadata->submissionHeartbeatAt', previous)
    : query.is('metadata->submissionHeartbeatAt', null);
  const { data, error } = await query.select('id');
  return !error && Array.isArray(data) && data.length === 1;
};

/**
 * Only expire the submitted row if the shared lease is still stale at the
 * exact moment of the update. Reading a stale UI snapshot is never enough.
 * Return false on network errors, missing rows, or if another tab progressed.
 */
export const failStalePendingVideo = async (
  db: GenerationDatabase,
  userId: string,
  id: string,
  message: string,
  now = Date.now(),
): Promise<boolean> => {
  const { data: current, error: readError } = await db.from('generations')
    .select('metadata,task_id').eq('id', id).eq('user_id', userId)
    .eq('type', 'video').eq('status', 'pending').maybeSingle();
  if (readError || !current || current.task_id) return false;
  const heartbeat = current.metadata?.submissionHeartbeatAt;
  const leaseCutoff = now - VIDEO_SUBMISSION_LEASE_MS;
  if (heartbeat != null && (!Number.isFinite(Number(heartbeat)) || Number(heartbeat) >= leaseCutoff)) return false;

  let query = db.from('generations')
    .update({ status: 'failed', metadata: { ...(current.metadata || {}), error: message } })
    .eq('id', id).eq('user_id', userId)
    .eq('type', 'video').eq('status', 'pending')
    .lte('created_at', now - STUCK_PENDING_MS);
  // Compare the persisted lease again at UPDATE time; a concurrent heartbeat
  // or provider transition must win over this stale read.
  query = heartbeat == null
    ? query.is('metadata->submissionHeartbeatAt', null)
    : query.lt('metadata->submissionHeartbeatAt', leaseCutoff);
  query = current.task_id == null ? query.is('task_id', null) : query.eq('task_id', '');
  const { data, error } = await query.select('id');
  return !error && Array.isArray(data) && data.length === 1;
};

/** Fire-and-forget recovery must not delay gallery or image-job startup. */
export const scheduleStaleVideoCheck = (
  check: () => Promise<boolean>,
  isCancelled: () => boolean,
  onFailed: () => void,
): void => {
  void check().then(failed => {
    if (failed && !isCancelled()) onFailed();
  }).catch(() => {});
};

/** Avoid repeated reads of an unchanged pending row in a different tab. */
export const allowPeriodicStaleCheck = (
  checkedAt: Map<string, number>,
  id: string,
  now: number,
): boolean => {
  const previous = checkedAt.get(id);
  if (previous !== undefined && now - previous < 60_000) return false;
  checkedAt.set(id, now);
  return true;
};
