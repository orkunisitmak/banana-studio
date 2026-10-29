import { WorkspaceQuery } from './query.mjs';
import { postNativeAction } from './nativeBridge';

export const createLocalWorkspaceClient = (config: { userId: string; sessionId: string }) => {
  const user = { id: config.userId, email: 'local@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false };
  // This is a compatibility identifier, never an authentication credential.
  // Every loopback operation requires the native app's HttpOnly session cookie.
  const session = { user, access_token: `local.${btoa(JSON.stringify({ session_id: config.sessionId }))}.local`, token_type: 'bearer', expires_at: 4102444800 };
  const send = async (plan: unknown, signal?: AbortSignal) => {
    const response = await fetch('/local/query', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(plan), signal });
    if (!response.ok) throw new Error('Local workspace is unavailable. Reopen Banana Studio.');
    return response.json();
  };
  const storage = (bucket: string) => {
    if (bucket !== 'media') throw new Error('Unknown local media bucket.');
    const mediaUrl = (path: string) => `${location.origin}/storage/v1/object/authenticated/media/${path.split('/').map(encodeURIComponent).join('/')}`;
    const action = async (name: string, paths: string[], options?: unknown) => send({ storage: name, paths, options });
    return {
      upload: async (path: string, value: Blob | ArrayBuffer | Uint8Array, options: { contentType?: string; upsert?: boolean } = {}) => {
        const body = value instanceof Blob ? value : new Blob([value as BlobPart]);
        const response = await fetch('/local/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': options.contentType || body.type || 'application/octet-stream', 'X-Media-Path': encodeURIComponent(path), 'X-Upsert': String(!!options.upsert) }, body });
        return response.json();
      },
      download: async (path: string) => { const response = await fetch(mediaUrl(path), { credentials: 'same-origin' }); return response.ok ? { data: await response.blob(), error: null } : { data: null, error: { statusCode: response.status, message: 'Local media unavailable.' } }; },
      remove: (paths: string[]) => action('remove', paths),
      // Like Supabase Storage: a missing object is a 404, not a URL that fails later.
      createSignedUrl: async (path: string) => { const r = await action('stat', [path]); if (r.error) return { data: null, error: r.error }; return r.data?.[0]?.exists ? { data: { signedUrl: mediaUrl(path) }, error: null } : { data: null, error: { statusCode: 404, message: 'Object not found' } }; },
      createSignedUrls: async (paths: string[]) => { const r = await action('stat', paths); return { data: paths.map((path, i) => ({ path, signedUrl: r.data?.[i]?.exists ? mediaUrl(path) : '', error: r.data?.[i]?.exists ? null : 'Not found' })), error: null }; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: mediaUrl(path) } }),
    };
  };
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      refreshSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      stopAutoRefresh() {},
      signOut: async () => { postNativeAction('lock'); return { error: null }; },
    },
    from: (table: string) => new WorkspaceQuery(send, table),
    rpc: (rpc: string, args = {}) => new WorkspaceQuery(send, undefined, rpc, args),
    storage: { from: storage },
  };
};
