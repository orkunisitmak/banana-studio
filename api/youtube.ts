import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, requireUser } from './_lib/auth.js';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

const ALLOWED_ENDPOINTS = new Set(['videos', 'channels', 'playlistItems', 'search']);

const ALLOWED_PARAMS = new Set([
  'part',
  'id',
  'forHandle',
  'forUsername',
  'playlistId',
  'pageToken',
  'maxResults',
  'q',
  'type',
  'fields',
]);

interface YoutubeProxyRequest {
  endpoint: string;
  params?: Record<string, string>;
}

export const sanitizeYoutubeParams = (raw: unknown): Record<string, string> => {
  const safe: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return safe;

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Drop any attempt to supply or override the server API key
    if (k.toLowerCase() === 'key') continue;
    if (!ALLOWED_PARAMS.has(k) || typeof v !== 'string') continue;

    if (k === 'maxResults') {
      const match = /^\d+$/.exec(v);
      if (!match || match[0] !== v) continue;
      const parsed = Number(v);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        safe.maxResults = String(Math.min(parsed, 50));
      }
      continue;
    }

    // Limit value length to prevent unbounded query strings
    if (v.length <= 1000) {
      safe[k] = v;
    }
  }

  return safe;
};

export const buildYoutubeRequestUrl = (endpoint: string, apiKey: string, params?: unknown): URL | null => {
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) return null;
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  const safeParams = sanitizeYoutubeParams(params);
  for (const [k, v] of Object.entries(safeParams)) {
    url.searchParams.set(k, v);
  }
  // The server API key is always enforced and cannot be overridden by input parameters
  url.searchParams.set('key', apiKey);
  return url;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured on server' });
  }

  let body: YoutubeProxyRequest;
  try {
    body =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as YoutubeProxyRequest)
        : (req.body as YoutubeProxyRequest);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { endpoint, params } = body || ({} as YoutubeProxyRequest);
  if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
    return res.status(400).json({ error: `Unsupported endpoint: ${endpoint}` });
  }

  const url = buildYoutubeRequestUrl(endpoint, apiKey, params);
  if (!url) {
    return res.status(400).json({ error: `Unsupported endpoint: ${endpoint}` });
  }

  try {
    const response = await fetch(url.toString());
    const text = await response.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res
        .status(502)
        .json({ error: `YouTube returned non-JSON response (${response.status})` });
    }

    if (!response.ok || data?.error) {
      const message = data?.error?.message || `YouTube API error (${response.status})`;
      return res.status(response.status || 502).json({ error: message });
    }

    return res.status(200).json(data);
  } catch {
    // Upstream errors may repeat or encode the credential-bearing request URL.
    console.error('YouTube proxy request failed');
    return res.status(500).json({ error: 'YouTube request failed' });
  }
}
