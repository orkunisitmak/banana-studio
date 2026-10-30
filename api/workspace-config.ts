import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCloudWorkspaceConfig } from './_lib/workspaceConfig.js';
/** The allowlist is intentional: never spread process.env into a response. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try { return res.status(200).json(getCloudWorkspaceConfig()); }
  catch { return res.status(503).json({ code: 'WORKSPACE_NOT_CONFIGURED', error: 'Configure your workspace Supabase URL and publishable key on the server.' }); }
}
