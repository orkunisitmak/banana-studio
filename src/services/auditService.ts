import { supabase } from './authService';

export interface AuditEvent {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

const authHeaders = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const fetchAuditEvents = async (limit = 50, cursor?: string): Promise<AuditPage> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('before', cursor);
  const response = await fetch(`/api/audit-event?${params.toString()}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Audit history could not be loaded.');
  const payload = await response.json();
  return {
    events: Array.isArray(payload.events) ? payload.events : [],
    nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
  };
};
