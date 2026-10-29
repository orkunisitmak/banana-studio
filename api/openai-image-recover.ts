import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, createUserScopedClient, requireUser } from './_lib/auth.js';
import { readStoredImage, signedMediaUrl } from './_lib/imageStorage.js';
import { RECOVERABLE_IMAGE_MODELS } from '../src/lib/images/openaiImage.js';

export const config = { maxDuration: 60 };

/** Recover an existing object only. This endpoint never calls an image provider. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid request body' }); }
  if (typeof body?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id)) return res.status(400).json({ error: 'Invalid generation ID' });
  const db = createUserScopedClient(req);
  const { data: row, error } = await db.from('generations').select('id, image_model, status, metadata')
    .eq('id', body.id).eq('user_id', user.id).maybeSingle();
  if (error) return res.status(503).json({ error: 'Could not check the saved generation. Try recovery again shortly.' });
  if (!row || !RECOVERABLE_IMAGE_MODELS.includes(row.image_model)) return res.status(404).json({ error: 'Saved image generation not found.' });
  // Do not race a live worker or overwrite a still-changing metadata object.
  const startedAt = Number(row.metadata?.openaiStartedAt);
  if (row.status === 'processing' && (!startedAt || Date.now() - startedAt < 330_000)) {
    return res.status(409).json({ error: 'This generation is still processing. Wait before recovering it.' });
  }
  const format = row.metadata?.openaiImageOptions?.outputFormat;
  const preferred = format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
  const storage = db.storage.from('media');
  for (const extension of new Set([preferred, 'png', 'jpg', 'webp'])) {
    // Never trust a client or stored URL/path to choose another user's object.
    const path = `openai/${user.id}/${body.id}.${extension}`;
    let file;
    try { file = await readStoredImage(storage, path, row.metadata?.imageOutputSha256, true); }
    catch { return res.status(503).json({ error: 'Storage could not be checked. Try recovery again shortly.' }); }
    if (!file) continue;
    let url: string;
    try { url = await signedMediaUrl(storage, path); }
    catch { return res.status(503).json({ error: 'The image exists, but private access could not be created. Try recovery again shortly.' }); }
    const metadata = { ...row.metadata, imageOutputSize: file.size, imageOutputBytes: file.bytes, imageStoragePath: path, storageRecoveredAt: Date.now() };
    delete metadata.error;
    const { error: saveError } = await db.from('generations').update({ status: 'completed', url: '', storage_path: path, metadata })
      .eq('id', body.id).eq('user_id', user.id);
    if (saveError) return res.status(503).json({ error: 'The image exists, but its gallery record could not be restored. Try recovery again shortly.' });
    return res.status(200).json({ id: body.id, url, storagePath: path, metadata });
  }
  return res.status(404).json({ error: 'No intact saved image file was found for this generation. Recovery did not generate another image or incur a new generation charge.' });
}
