import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { listLocalModels, localServerStatus } from './_lib/localMedia.js';
import { LOCAL_SERVERS, type LocalServer } from '../src/lib/localModels.js';

/** Discovery only: lists installed models/workflows and probes configured local servers. Nothing is generated. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireUser(req, res)) return;
  if (req.query?.status) return res.status(200).json({ servers: await localServerStatus() });
  const server = String(req.query?.server || '');
  try { return res.status(200).json(await listLocalModels(server)); }
  catch (error) {
    // Network failures (server stopped, wrong port) read as "fetch failed"; name the server instead.
    const offline = error instanceof TypeError || (error as Error)?.name === 'TimeoutError';
    const label = LOCAL_SERVERS[server as LocalServer]?.label || 'The local server';
    return res.status(502).json({ error: offline ? `${label} is not answering. Start it and refresh.` : error instanceof Error ? error.message : 'The local server could not be reached.' });
  }
}
