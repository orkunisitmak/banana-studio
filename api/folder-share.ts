import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'node:crypto';
import { createServiceRoleClient, requireUser } from './_lib/auth.js';
import { recordAuditEvent } from './_lib/audit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await requireUser(req, res);
  if (!user) return;
  const { folderId, action } = req.body || {};
  if (typeof folderId !== 'string' || !folderId.length || folderId.length > 128
    || !['status', 'create', 'revoke'].includes(action)) return res.status(400).json({ error: 'Invalid sharing request' });
  const db = createServiceRoleClient();
  if (!db) return res.status(503).json({ error: 'Folder sharing is unavailable' });
  try {
    // Admin gallery read privileges do not grant permission to publish another owner's folder.
    const folder = await db.from('folders').select('id').eq('id', folderId).eq('user_id', user.id).maybeSingle();
    if (folder.error) throw folder.error;
    if (!folder.data) return res.status(404).json({ error: 'Folder not found' });
    if (action === 'create') {
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      const { error } = await db.from('folder_shares').upsert({
        folder_id: folderId, user_id: user.id, token_hash: createHash('sha256').update(token).digest('hex'),
        share_token: token, legacy_token_hash: null, expires_at: expiresAt, created_at: new Date().toISOString(),
      }, { onConflict: 'folder_id' });
      if (error) throw error;
      await recordAuditEvent(db, { userId: user.id, action: 'share.created', targetType: 'folder', targetId: folderId });
      return res.status(200).json({ active: true, token, expiresAt });
    }
    if (action === 'revoke') {
      const { error } = await db.from('folder_shares').delete().eq('folder_id', folderId).eq('user_id', user.id);
      if (error) throw error;
      await recordAuditEvent(db, { userId: user.id, action: 'share.revoked', targetType: 'folder', targetId: folderId });
      return res.status(200).json({ active: false });
    }
    let share = await db.from('folder_shares').select('expires_at,share_token,token_hash').eq('folder_id', folderId).eq('user_id', user.id).maybeSingle();
    if (share.error) throw share.error;
    if (share.data && Date.parse(share.data.expires_at) > Date.now()
      && (!share.data.share_token || createHash('sha256').update(share.data.share_token).digest('hex') !== share.data.token_hash)) {
      // Hash-only links cannot be recovered. Give the owner a retrievable link
      // while retaining the old capability until explicit rotation/revocation.
      // Compare-and-set prevents concurrent dialog opens from rotating each other.
      const token = randomBytes(32).toString('base64url');
      const upgraded = await db.from('folder_shares').update({
        share_token: token, token_hash: createHash('sha256').update(token).digest('hex'),
        legacy_token_hash: share.data.token_hash,
      }).eq('folder_id', folderId).eq('user_id', user.id).eq('token_hash', share.data.token_hash)
        .select('expires_at,share_token,token_hash').maybeSingle();
      if (upgraded.error) throw upgraded.error;
      share = upgraded.data ? upgraded : await db.from('folder_shares').select('expires_at,share_token,token_hash')
        .eq('folder_id', folderId).eq('user_id', user.id).maybeSingle();
      if (share.error) throw share.error;
    }
    const active = !!share.data && Date.parse(share.data.expires_at) > Date.now();
    return res.status(200).json({ active, expiresAt: share.data?.expires_at,
      ...(active && share.data?.share_token ? { token: share.data.share_token } : {}) });
  } catch {
    return res.status(503).json({ error: 'Folder sharing is unavailable. Please try again.' });
  }
}
