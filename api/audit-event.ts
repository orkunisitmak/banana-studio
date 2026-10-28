import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createServiceRoleClient, createUserScopedClient, requireUser } from './_lib/auth.js';
import { normalizeAuditEvent, recordAuditEvent } from './_lib/audit.js';

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  if (process.env.BANANA_RUNTIME === 'local') {
    if (req.method === 'POST') return res.status(204).end();
    if (req.method === 'GET') return res.status(200).json({ events: [] });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method === 'GET') {
    const requested = Number(req.query.limit || 50);
    const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 50;
    const { data, error } = await createUserScopedClient(req)
      .from('audit_events')
      .select('id,user_id,action,target_type,target_id,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return res.status(503).json({ error: 'Audit history is temporarily unavailable.' });
    return res.status(200).json({ events: data || [] });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const event = normalizeAuditEvent({ ...(req.body || {}), userId: user.id });
  if (!event) return res.status(400).json({ error: 'Unsupported audit event.' });
  const writer = createServiceRoleClient();
  if (!writer) return res.status(503).json({ error: 'Audit logging is not configured.' });
  const recorded = await recordAuditEvent(writer, event);
  if (!recorded) return res.status(503).json({ error: 'The audit event could not be recorded.' });
  return res.status(201).json({ ok: true });
}
