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

const authHeaders = async (): Promise<Record<string, string>> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const fetchAuditEvents = async (limit = 50): Promise<AuditEvent[]> => {
  const response = await fetch(`/api/audit-event?limit=${encodeURIComponent(limit)}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Audit history could not be loaded.');
  const payload = await response.json();
  return Array.isArray(payload.events) ? payload.events : [];
};

export const recordAuditEvent = async (event: {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const response = await fetch('/api/audit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error('The audit event could not be recorded.');
};
