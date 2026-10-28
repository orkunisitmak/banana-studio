import type { VercelRequest, VercelResponse } from '@vercel/node';

const allowedCorsOrigins = (): string[] => (process.env.BANANA_CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

/**
 * Same-origin is the default and needs no CORS header. Cross-origin callers
 * must be explicitly allowlisted with BANANA_CORS_ORIGIN. Returns false when
 * the request has been answered (preflight), so callers can stop immediately.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedCorsOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  return true;
}
