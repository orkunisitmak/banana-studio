import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { providerAvailability } from './_lib/providerConfiguration.js';
import { localServerStatus } from './_lib/localMedia.js';
import { LOCAL_PROVIDERS } from '../src/lib/providers.js';

/**
 * Lightweight status endpoint so the client can decide whether to surface
 * the "API key required" UI without leaking any actual credentials.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!await requireUser(req, res)) return;

  const providers = providerAvailability();
  // A configured local server counts only while it answers, so Auto skips a stopped Ollama for a running LM Studio.
  const local = await localServerStatus();
  for (const provider of LOCAL_PROVIDERS) if (local[provider] != null) providers[provider] = local[provider] === true;
  const configured = Boolean(providers.gemini || providers.openrouter);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ configured, providers,
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()) && process.env.OPENROUTER_ENABLED !== 'false',
  });
}
