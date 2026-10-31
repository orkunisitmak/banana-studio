import type { VercelResponse } from '@vercel/node';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// The browser saves a pending video before any paid provider submission.
// A conditional database claim, not an in-memory lock, enforces one submission per id.
export const validVideoGenerationId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id);

type Provider = 'fal' | 'openrouter' | 'evolink';
type Claim = { kind: 'fresh'; id: string } | {
  kind: 'existing'; taskId: string; endpoint?: string; usage?: unknown;
};
const metadataOf = (value: any): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const taskProof = (id: string, userId: string, provider: Provider, taskId: string): string | undefined => {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return undefined;
  return createHmac('sha256', secret)
    .update(JSON.stringify(['banana:video-task:v1', id, userId, provider, taskId])).digest('hex');
};

/** User-editable gallery fields cannot grant task ownership without a server HMAC. */
export async function recoverSignedVideoTask(
  db: any, id: string, userId: string, provider: Provider, taskId: string, metadata: any,
): Promise<boolean> {
  const supplied = metadataOf(metadata).videoSubmissionTaskProof;
  const expected = taskProof(id, userId, provider, taskId);
  if (!expected || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)
    || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) return false;
  try {
    const existing = await db.from('provider_tasks').select('user_id')
      .eq('provider', provider).eq('task_id', taskId).eq('user_id', userId).maybeSingle();
    if (!existing.error && existing.data?.user_id === userId) return true;
    const inserted = await db.from('provider_tasks').insert({ provider, task_id: taskId, user_id: userId });
    return !inserted.error;
  } catch { return false; }
}

/**
 * Validate a caller-owned pending row and atomically claim it before dispatch.
 * Reusing the same generation ID must never dispatch a second paid request,
 * even if the first HTTP acknowledgement was lost.
 */
export async function claimVideoSubmission(
  db: any, res: VercelResponse, id: unknown, userId: string,
  provider: Provider, model: string, requestBody: unknown,
): Promise<Claim | null> {
  if (!validVideoGenerationId(id)) {
    res.status(400).json({ error: 'A saved video generation ID is required before paid submission.' });
    return null;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([provider, model, requestBody])).digest('hex');
  try {
    const read = await db.from('generations')
      .select('id,user_id,type,image_model,status,task_id,metadata')
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (read.error) throw read.error;
    const row = read.data;
    if (!row || row.user_id !== userId || row.type !== 'video' || row.image_model !== model) {
      res.status(404).json({ error: 'Saved video generation was not found. No paid request was sent.' });
      return null;
    }
    const metadata = metadataOf(row.metadata);
    if (metadata.videoSubmissionFingerprint && metadata.videoSubmissionFingerprint !== fingerprint) {
      res.status(409).json({ error: 'This generation ID was already used for a different video request.', code: 'VIDEO_SUBMISSION_MISMATCH' });
      return null;
    }
    if (row.task_id) {
      // User-editable gallery fields are not proof of task ownership.
      // Always verify the privileged provider_tasks table before returning a handle.
      if (metadata.videoSubmissionProvider && metadata.videoSubmissionProvider !== provider) {
        res.status(409).json({ error: 'This video was already submitted to another provider.', code: 'VIDEO_SUBMISSION_MISMATCH' });
        return null;
      }
      const owner = await db.from('provider_tasks').select('user_id')
        .eq('provider', provider).eq('task_id', row.task_id).eq('user_id', userId).maybeSingle();
      if (owner.error || !owner.data || owner.data.user_id !== userId) {
        if (!await recoverSignedVideoTask(db, id, userId, provider, row.task_id, metadata)) {
          res.status(503).json({ error: 'The original video task is not registered yet. Do not submit it again.', code: 'VIDEO_TASK_UNREGISTERED', retryable: true });
          return null;
        }
      }
      return {
        kind: 'existing', taskId: row.task_id,
        endpoint: typeof metadata.falEndpoint === 'string' ? metadata.falEndpoint : undefined,
        usage: metadata.providerUsage || undefined,
      };
    }
    if (row.status !== 'pending' || metadata.videoSubmissionStartedAt) {
      res.status(409).json({ code: 'GENERATION_SUBMITTING', retryable: true,
        error: 'This video was already submitted or acceptance is uncertain. Do not pay for it again; check task history.' });
      return null;
    }
    const claimedMetadata = {
      ...metadata, videoSubmissionStartedAt: Date.now(), videoSubmissionProvider: provider,
      videoSubmissionFingerprint: fingerprint,
    };
    const result = await db.from('generations')
      .update({ status: 'processing', metadata: claimedMetadata })
      .eq('id', id).eq('user_id', userId).eq('status', 'pending')
      .select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) {
      res.status(409).json({ code: 'GENERATION_SUBMITTING', retryable: true,
        error: 'Another request already claimed this video. Do not send it again.' });
      return null;
    }
    return { kind: 'fresh', id };
  } catch {
    res.status(503).json({ error: 'Video submission tracking is unavailable. No provider request was dispatched.', retryable: true, dispatched: false });
    return null;
  }
}

/** A provider-confirmed ID is saved server-side before the browser receives it. */
export async function saveAcceptedVideoTask(
  db: any, generationId: string, userId: string, taskId: string,
  extras: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await db.from('generations').select('id,status,task_id,metadata')
        .eq('id', generationId).eq('user_id', userId).eq('type', 'video').maybeSingle();
      if (current.error || !current.data || current.data.status !== 'processing') return false;
      if (current.data.task_id && current.data.task_id !== taskId) return false;
      const snapshot = current.data.metadata;
      const metadata = { ...metadataOf(snapshot), ...extras };
      const provider = metadata.videoSubmissionProvider;
      if (provider === 'fal' || provider === 'openrouter' || provider === 'evolink')
        metadata.videoSubmissionTaskProof = taskProof(generationId, userId, provider, taskId);
      let update = db.from('generations')
        .update({ task_id: taskId, metadata })
        .eq('id', generationId).eq('user_id', userId).eq('type', 'video').eq('status', 'processing');
      update = snapshot == null ? update.is('metadata', null) : update.eq('metadata', JSON.stringify(snapshot));
      const saved = await update.select('id').maybeSingle();
      if (saved.error) return false;
      if (saved.data) return true;
    }
  } catch { /* An accepted task is never resubmitted because its local save failed. */ }
  return false;
}
