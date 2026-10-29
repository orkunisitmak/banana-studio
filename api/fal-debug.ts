import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireAdmin } from './_lib/auth.js';

/**
 * One-shot diagnostic endpoint for verifying that the FAL_KEY configured on
 * the server actually belongs to the fal.ai account the user expects to see
 * generations under.
 *
 * It returns:
 *  - probe      : HTTP status fal.ai returned for a GET against a known
 *                 model URL using this key. 200/4xx-with-JSON proves the key
 *                 is being accepted by fal; 401/403 proves the key is wrong.
 *
 * Active administrator access is required; no credential fragments are returned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyCors(req, res)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAdmin(req, res);
  if (!user) return;

  const apiKey = process.env.FAL_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

  // Hit a cheap fal.ai endpoint to prove the key is accepted. We use the
  // queue base URL with an obviously-non-existent request so fal returns a
  // structured 4xx rather than queuing a job; the important signal is that
  // fal recognised the auth header (anything other than 401/403 means the
  // key works for this account).
  let probeStatus: number | null = null;
  let probeError: string | null = null;
  try {
    const probe = await fetch(
      'https://queue.fal.run/fal-ai/nano-banana-pro/requests/__probe__/status',
      { headers: { Authorization: `Key ${apiKey}` } },
    );
    probeStatus = probe.status;
  } catch (err: any) {
    probeError = 'The provider could not be reached.';
  }

  return res.status(200).json({
    probe: {
      status: probeStatus,
      error: probeError,
      // 401/403 = key rejected. Anything else = key accepted (probe id is
      // intentionally bogus so fal returns a 4xx-with-JSON).
      keyAccepted: probeStatus !== null && probeStatus !== 401 && probeStatus !== 403,
    },
  });
}
