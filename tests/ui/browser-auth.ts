// Synthetic service boundary for real React + IndexedDB browser regressions.
import { WorkspaceQuery } from '../../desktop/shared/query.mjs';
let userId: string | null = 'account-a';
const listeners = new Set<(session: any, event: string) => void>();
export const SUPABASE_URL = 'https://example.invalid';
export const getCurrentUserId = async () => userId;
export const getSession = async () => userId ? { user: { id: userId }, access_token: 'synthetic' } : null;
export const getProfile = async () => userId ? { id: userId, role: 'user', display_name: 'Synthetic account' } : null;
export const checkUserAuthorization = async () => 'authorized';
export const onAuthStateChange = (listener: (session: any, event: string) => void) => {
  listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
};
export async function chooseAccount(id: string | null) {
  userId = id; const session = await getSession();
  for (const listener of listeners) listener(session, id ? 'SIGNED_IN' : 'SIGNED_OUT');
}
export const signOut = () => chooseAccount(null);
export const supabase = {
  from: (table: string) => new WorkspaceQuery(async () => ({ data: null, error: null }), table),
};
