/** Events that only server code may write. */
export const SERVER_AUDIT_ACTIONS = new Set([
  'generation.accepted',
  'generation.rejected_quota',
]);

/** Events that an authenticated browser session may submit. */
export const CLIENT_AUDIT_ACTIONS = new Set([
  'share.created',
  'share.revoked',
  'media.deleted',
  'media.edited',
  'folder.created',
  'folder.deleted',
  'brand.updated',
]);

export interface AuditEventInput {
  userId: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

const MAX_METADATA_BYTES = 4_000;

export const normalizeAuditEvent = (input: unknown): AuditEventInput | null => {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  if (typeof source.userId !== 'string' || !source.userId) return null;
  if (typeof source.action !== 'string' || !CLIENT_AUDIT_ACTIONS.has(source.action)) return null;
  const targetType = typeof source.targetType === 'string' ? source.targetType.trim().slice(0, 40) || null : null;
  const targetId = typeof source.targetId === 'string' ? source.targetId.trim().slice(0, 200) || null : null;
  const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? source.metadata as Record<string, unknown>
    : {};
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_METADATA_BYTES) return null;
  return { userId: source.userId, action: source.action, targetType, targetId, metadata };
};

export const recordAuditEvent = async (db: any, event: AuditEventInput): Promise<boolean> => {
  try {
    const { error } = await db.from('audit_events').insert({
      user_id: event.userId,
      action: event.action,
      target_type: event.targetType || null,
      target_id: event.targetId || null,
      metadata: event.metadata || {},
    });
    if (error) {
      console.warn('Audit event could not be recorded', error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Audit event could not be recorded', error);
    return false;
  }
};
