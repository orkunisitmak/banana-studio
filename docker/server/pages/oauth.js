// Consent screen for Supabase Auth's OAuth 2.1 server (/oauth/consent) and the
// list of connected assistants (/oauth/connections). It shares the web app's
// stored session, so a person already signed in to the gallery is not asked again.
const app = document.getElementById('app');
const storageKey = `banana-studio:${location.host}:auth`;
const verifierKey = `banana-studio:${location.host}:oauth-pkce`;
let apikey;

/** Create an element with properties and children. */
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
/** Replace the page content. */
const render = (...children) => app.replaceChildren(...children);
/** Show an error message in place of the page. */
const fail = message => render(el('h1', {}, 'Banana Studio'), el('p', { className: 'error', role: 'alert' }, message));
/** Call the Auth API; a non-2xx response throws with Auth's message and the HTTP status. */
const auth = async (path, { method = 'GET', token, body, query } = {}) => {
  const url = new URL(`/auth/v1${path}`, location.origin);
  for (const [name, value] of Object.entries(query || {})) url.searchParams.set(name, value);
  const response = await fetch(url, { method, headers: { apikey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.msg || data?.message || data?.error_description || data?.error || `Request failed (${response.status})`), { status: response.status });
  return data;
};
/** Store the session where the web app keeps it, so both share one sign-in. */
const save = session => { localStorage.setItem(storageKey, JSON.stringify(session)); return session; };

/** Base64url-encode bytes (for the PKCE verifier and challenge). */
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * The stored web-app session, refreshed when close to expiry, or one returned from
 * Google sign-in. Sign-in uses PKCE: only a code whose verifier this tab created
 * is exchanged, so a crafted return link cannot sign the page in as someone else.
 */
async function session() {
  const params = new URLSearchParams(location.search), code = params.get('code'), failure = params.get('error_description');
  if (code || failure) {
    const verifier = sessionStorage.getItem(verifierKey);
    sessionStorage.removeItem(verifierKey);
    for (const name of ['code', 'error', 'error_code', 'error_description']) params.delete(name);
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''));
    if (!code) throw new Error(failure);
    if (!verifier) throw new Error('This sign-in was not started on this page. Start again from your assistant.');
    const result = await auth('/token', { method: 'POST', query: { grant_type: 'pkce' }, body: { auth_code: code, code_verifier: verifier } });
    return save({ ...result, expires_at: result.expires_at || Math.floor(Date.now() / 1000) + (result.expires_in || 3600) });
  }
  let stored; try { stored = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { stored = null; }
  if (!stored?.access_token) return null;
  if ((stored.expires_at || 0) * 1000 > Date.now() + 60_000) return stored;
  try { return save(await auth('/token', { method: 'POST', query: { grant_type: 'refresh_token' }, body: { refresh_token: stored.refresh_token } })); }
  catch { localStorage.removeItem(storageKey); return null; }
}

/** Start Google sign-in with a fresh PKCE verifier kept in this tab. */
const startGoogle = async () => {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(verifierKey, verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const url = new URL('/auth/v1/authorize', location.origin);
  for (const [name, value] of Object.entries({ provider: 'google', redirect_to: location.href, code_challenge: challenge, code_challenge_method: 's256' })) url.searchParams.set(name, value);
  location.assign(url);
};

/** Show the Google sign-in step. */
const signIn = () => render(
  el('h1', {}, 'Sign in to Banana Studio'),
  el('p', {}, 'Sign in with the Google account that was invited to this workspace.'),
  el('div', { className: 'actions' }, el('button', { type: 'button', className: 'primary', onclick: () => void startGoogle().catch(error => fail(error.message)) }, 'Continue with Google')),
);

/** Show the consent screen for `authorization_id`, or return at once when consent was already given. */
async function consent(current) {
  const id = new URLSearchParams(location.search).get('authorization_id');
  if (!id) return fail('This sign-in request is missing its authorization ID. Start again from your assistant.');
  const details = await auth(`/oauth/authorizations/${encodeURIComponent(id)}`, { token: current.access_token });
  if (details.redirect_url) return location.assign(details.redirect_url);
  // Approving is pointless for an account the workspace does not let in.
  const access = await fetch('/api/gemini-status', { headers: { Authorization: `Bearer ${current.access_token}` } });
  if (access.status === 403) return fail(`${current.user?.email || 'This account'} has no access to this workspace. Ask an administrator for an invitation.`);
  const client = details.client || {};
  const name = client.client_name || client.name || 'An application';
  let redirectHost = ''; try { redirectHost = new URL(details.redirect_uri).host; } catch { /* Shown without a host. */ }
  const decide = action => async event => {
    for (const button of app.querySelectorAll('button')) button.disabled = true;
    try { const result = await auth(`/oauth/authorizations/${encodeURIComponent(id)}/consent`, { method: 'POST', token: current.access_token, body: { action } }); location.assign(result.redirect_url); }
    catch (error) { fail(error.message); }
    event.preventDefault();
  };
  render(
    el('h1', {}, `Connect ${name} to Banana Studio`),
    el('p', {}, el('strong', {}, name), ' will act as ', el('strong', {}, current.user?.email || 'you'), ' in this workspace. It can:'),
    el('ul', {}, el('li', {}, 'see your gallery, folders and generation results'), el('li', {}, 'start image and video generations, billed to the workspace\'s provider accounts')),
    redirectHost ? el('p', {}, `After you choose, you return to ${redirectHost}.`) : '',
    el('p', {}, 'You can disconnect it at any time under ', el('a', { href: '/oauth/connections' }, 'Connected apps'), '.'),
    el('div', { className: 'actions' }, el('button', { type: 'button', onclick: decide('deny') }, 'Deny'), el('button', { type: 'button', className: 'primary', onclick: decide('approve') }, 'Allow')),
  );
}

/** List the assistants connected to this account, each with a Disconnect button. */
async function connections(current) {
  const grants = await auth('/user/oauth/grants', { token: current.access_token });
  const list = Array.isArray(grants) ? grants : grants?.grants || [];
  render(
    el('h1', {}, 'Connected apps'),
    el('p', {}, `Assistants that can act as ${current.user?.email || 'you'} in this workspace.`),
    ...(list.length ? list.map(grant => {
      // Grants list the client as { id, name }; authorization details use client_id / client_name.
      const client = grant.client || {}, clientId = client.id || client.client_id;
      const revoke = el('button', { type: 'button', onclick: async () => { revoke.disabled = true; try { await auth('/user/oauth/grants', { method: 'DELETE', token: current.access_token, query: { client_id: clientId } }); await connections(current); } catch (error) { fail(error.message); } } }, 'Disconnect');
      return el('div', { className: 'grant' }, el('span', {}, el('strong', {}, client.name || client.client_name || clientId || 'Application'), el('br'), grant.granted_at ? `Connected ${new Date(grant.granted_at).toLocaleString()}` : ''), revoke);
    }) : [el('p', {}, 'No assistant is connected.')]),
    el('div', { className: 'actions' }, el('a', { className: 'button', href: '/' }, 'Back to the gallery')),
  );
}

try {
  const config = await fetch('/api/workspace-config', { cache: 'no-store' });
  if (!config.ok) throw new Error('The workspace is temporarily unavailable. Try again.');
  apikey = (await config.json().catch(() => null))?.supabasePublishableKey;
  if (!apikey) throw new Error('The workspace configuration is incomplete.');
  const current = await session();
  if (!current) signIn();
  else if (location.pathname === '/oauth/connections') await connections(current);
  else await consent(current);
} catch (error) {
  if (error.status === 401) { localStorage.removeItem(storageKey); signIn(); }
  else fail(error.message || 'Something went wrong. Try again.');
}
