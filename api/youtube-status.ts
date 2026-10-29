import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!await requireUser(req, res)) return;

  const configured = Boolean(process.env.YOUTUBE_API_KEY);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ configured });
}
