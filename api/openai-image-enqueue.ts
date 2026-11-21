import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createServiceRoleClient, createUserScopedClient, requireUser } from './_lib/auth.js';
import { getOpenAISessionId } from './_lib/openaiGuard.js';
import { ImageJobInputError, prepareImageJobPayload } from './_lib/imageJobPayload.js';
import { publishImageJob } from './_lib/imageJobQueue.js';
import { requireSpendingAllowance } from './_lib/spendingLimit.js';

export const config = { maxDuration: 60 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control','no-store');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });
  const user = await requireUser(req,res); if (!user) return;
  if (!await requireSpendingAllowance(req, res)) return;
  if ((process.env.VERCEL_ENV && process.env.VERCEL_ENV!=='production')) return res.status(503).json({ error:'Image generation is temporarily disabled.' });
  const sessionId = getOpenAISessionId(req), db = createServiceRoleClient();
  if (!sessionId) return res.status(401).json({ error:'Refresh your session before generating.' });
  if (!db) return res.status(503).json({ error:'Image generation tracking is unavailable. No generation was submitted.' });
  let body: any;
  try { body = typeof req.body==='string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error:'Invalid image job.' }); }
  try {
    const { payload, metadata } = await prepareImageJobPayload(body,createUserScopedClient(req));
    const { data, error } = await db.rpc('enqueue_image_job', { p_user_id:user.id, p_session_id:sessionId, p_id:payload.id, p_payload:payload, p_metadata:metadata });
    if (error || !data) return res.status(503).json({ code:'QUEUE_STATE_UNKNOWN', error:'The queue could not confirm this image. Check the gallery before submitting again.' });
    if (data.error) return res.status(data.error==='session'?403:data.error==='full'?429:409).json({ error:data.error==='full'?'The saved image queue is full. Wait for existing jobs to finish.':'This generation could not be queued.', ...(data.error==='exists'?{code:'GENERATION_EXISTS'}:{}) });
    // The transactional outbox sweeper also publishes saved jobs after a
    // disconnect/crash or a temporarily unavailable queue service.
    if (!['completed','failed'].includes(data.state)) {
      try { await publishImageJob(db,{ id:payload.id, userId:user.id }); }
      catch { console.warn('Image job saved; publication will be reconciled',payload.id); }
    }
    return res.status(202).json({ id:payload.id, queued:true, durable:true });
  } catch (error) {
    return res.status(error instanceof ImageJobInputError?400:503).json({ error:error instanceof ImageJobInputError?error.message:'Image queue preparation is unavailable. No provider request was sent.' });
  }
}
