import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';
import { LOCAL_AGENT_PROVIDERS, PROVIDER_KEYS, type KeyedProvider } from '../src/lib/providers.js';
import { localAgentStatusWarm } from './_lib/localAgents.js';

/** Detailed provider health for the Providers panel. Reports only whether a
 * key exists, never its value; local agents report install and sign-in state.
 * `?refresh=1` re-probes the CLIs (Check again, key changes); otherwise cached
 * status is served. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireUser(req, res)) return;
  const local = process.env.BANANA_RUNTIME === 'local';
  const fresh = String(req.query?.refresh || '') === '1';
  const keys = Object.fromEntries((Object.entries(PROVIDER_KEYS) as [KeyedProvider, string][]).map(([provider, variable]) => [provider, {
    configured: Boolean(process.env[variable]?.trim()), disabled: process.env[`${provider.toUpperCase()}_ENABLED`] === 'false',
  }]));
  return res.status(200).json({ local, keys,
    youtube: { configured: Boolean(process.env.YOUTUBE_API_KEY?.trim()) },
    agents: local ? Object.fromEntries(await Promise.all(LOCAL_AGENT_PROVIDERS.map(async agent => [agent, await localAgentStatusWarm(agent, { fresh })]))) : {},
  });
}
