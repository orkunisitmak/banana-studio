import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { waitForTask } from '../../src/lib/shared/asyncTask.js';
import { getCloudWorkspaceConfig } from './workspaceConfig.js';

// Token verification and caller-scoped queries need only the public key. Keep
// privileged credentials confined to server-owned task registration below.
const authClient = () => {
  const config = getCloudWorkspaceConfig();
  return createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

const getBearerToken = (req: VercelRequest): string => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  return value && value.startsWith('Bearer ')
    ? value.slice('Bearer '.length).trim()
    : '';
};

/** Storage/database requests keep the caller's RLS permissions. */
export const createUserScopedClient = (req: VercelRequest) => createClient(
  getCloudWorkspaceConfig().supabaseUrl,
  getCloudWorkspaceConfig().supabasePublishableKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${getBearerToken(req)}` } },
  },
);

/** Privileged writes are only for server-owned task associations. */
export const createServiceRoleClient = () => process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(getCloudWorkspaceConfig().supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

/**
 * Verify the Supabase token AND current active access-list membership on every
 * request. A valid OAuth account alone does not grant application access.
 * Authorization lookup failures deny access; no environment variable bypasses
 * these checks, including on production/preview deployments.
 */
export async function requireUser(
  req: VercelRequest,
  res: VercelResponse,
  signal?: AbortSignal,
): Promise<AuthenticatedUser | null> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return null;
  }

  let authenticated = false;
  try {
    const pending = authClient().auth.getUser(token);
    const { data, error } = await (signal ? waitForTask(pending, signal) : pending);
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return null;
    }
    authenticated = true;
    const email = data.user.email?.trim().toLowerCase();
    if (!email || !data.user.email_confirmed_at || data.user.is_anonymous === true) {
      res.status(403).json({ error: 'Application access required' });
      return null;
    }

    // Escape LIKE metacharacters: underscores and percent signs are valid in
    // email addresses and must never turn an exact membership check into a
    // wildcard match. Validate the returned row independently as well.
    const emailPattern = email.replace(/[\\%_]/g, character => `\\${character}`);
    const membership = createUserScopedClient(req)
      .from('authorized_emails')
      .select('email')
      .eq('is_active', true)
      .ilike('email', emailPattern)
      .maybeSingle();
    const { data: authorized, error: authorizationError } = await (signal ? waitForTask(membership, signal) : membership);
    if (authorizationError) {
      res.status(503).json({ error: 'Unable to verify application access. Try again shortly.' });
      return null;
    }
    if (authorized?.email?.trim().toLowerCase() !== email) {
      res.status(403).json({ error: 'Application access required' });
      return null;
    }
    return { id: data.user.id, email };
  } catch (err: any) {
    if (signal?.aborted) {
      res.status(504).json({ error: 'Session verification timed out. Refresh the page and try again.' });
      return null;
    }
    console.error('Auth verification failed:', err?.message || err);
    res.status(authenticated ? 503 : 401).json({ error: authenticated ? 'Unable to verify application access. Try again shortly.' : 'Authentication failed' });
    return null;
  }
}

/** Verify the caller and require their profile role to be admin. */
export async function requireAdmin(
  req: VercelRequest,
  res: VercelResponse,
): Promise<AuthenticatedUser | null> {
  const user = await requireUser(req, res);
  if (!user) return null;
  const { data, error } = await createUserScopedClient(req)
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (error || data?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }

  return user;
}

export function applyCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
