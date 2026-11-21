import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { createServiceRoleClient } from './_lib/auth.js';

const URL_LIFETIME_SECONDS = 60;
const PAGE_SIZE = 48;
type SharedRow = { id: string; storagePath: string; thumbnailPath: string | null };

/** Intentional public capability endpoint. Never accepts a caller-supplied storage path/URL. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const { token, offset = 0, mediaId } = req.body || {};
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).json({ error: 'This share link is unavailable or expired.' });
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000
    || (mediaId !== undefined && (typeof mediaId !== 'string' || !mediaId.length || mediaId.length > 128))) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  const db = createServiceRoleClient();
  if (!db) return res.status(503).json({ error: 'Shared folder is temporarily unavailable.' });
  try {
    const { data, error } = await db.rpc('resolve_folder_share', {
      p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_offset: mediaId ? 0 : offset, p_media_id: mediaId || null,
    });
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'This share link is unavailable or expired.' });
    const ttl = Math.min(URL_LIFETIME_SECONDS, Math.floor((Date.parse(data.expiresAt) - Date.now()) / 1000));
    if (!Number.isFinite(ttl) || ttl < 1) return res.status(404).json({ error: 'This share link is unavailable or expired.' });
    if (mediaId && !data.images.length) return res.status(404).json({ error: 'This image is no longer available in the shared folder.' });
    const rows: SharedRow[] = data.images.slice(0, mediaId ? 1 : PAGE_SIZE);
    // Only paths that passed the database's current folder + trusted storage ownership checks.
    const paths = [...new Set(rows.map(row => mediaId ? row.storagePath : row.thumbnailPath || row.storagePath))];
    const signed = paths.length ? await db.storage.from('media').createSignedUrls(paths, ttl) : { data: [], error: null };
    if (signed.error || signed.data?.some(entry => entry.error || !entry.signedUrl)) throw new Error('Media unavailable');
    const urls = new Map((signed.data || []).map(entry => [entry.path, entry.signedUrl]));
    if (rows.some(row => !urls.get(mediaId ? row.storagePath : row.thumbnailPath || row.storagePath))) throw new Error('Media unavailable');
    // Allowlist the public response. Do not spread private database rows into it.
    return res.status(200).json({ name: data.name, images: rows.map(row => ({
      id: row.id, url: urls.get(mediaId ? row.storagePath : row.thumbnailPath || row.storagePath),
    })), nextOffset: !mediaId && data.images.length > PAGE_SIZE ? offset + PAGE_SIZE : null });
  } catch {
    return res.status(503).json({ error: 'Shared folder is temporarily unavailable. Please try again.' });
  }
}
