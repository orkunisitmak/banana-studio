import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Audit events are written by server actions only.' });
  }

  if (process.env.BANANA_RUNTIME === 'local') return res.status(200).json({ events: [], nextCursor: null });

  const requested = Number(req.query.limit || 50);
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 50;
  const before = typeof req.query.before === 'string' ? req.query.before : '';
  const [beforeCreatedAt, beforeId] = before.split('|');
  let query = createUserScopedClient(req)
    .from('audit_events')
    .select('id,user_id,action,target_type,target_id,metadata,created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (beforeCreatedAt && beforeId) {
    query = query.or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`);
  }
  const { data, error } = await query;
  if (error) return res.status(503).json({ error: 'Audit history is temporarily unavailable.' });
  const rows = data || [];
  const events = rows.slice(0, limit);
  const last = events.at(-1);
  return res.status(200).json({
    events,
    nextCursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null,
  });
}
