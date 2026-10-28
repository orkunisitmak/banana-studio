import { getSession } from './authService';
import { recordAuditEvent } from './auditService';
import { readFolderShareStatus, type FolderShareStatus } from '../lib/gallery/folderShareResponse';

export type { FolderShareStatus } from '../lib/gallery/folderShareResponse';
export async function manageFolderShare(folderId: string, action: 'status' | 'create' | 'revoke'): Promise<FolderShareStatus> {
  const session = await getSession();
  if (!session?.access_token) throw new Error('Sign in again to manage sharing.');
  const response = await fetch('/api/folder-share', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ folderId, action }), cache: 'no-store',
  });
  const status = await readFolderShareStatus(response);
  if (action !== 'status') {
    void recordAuditEvent({
      action: action === 'create' ? 'share.created' : 'share.revoked',
      targetType: 'folder',
      targetId: folderId,
    }).catch(() => {});
  }
  return status;
}
