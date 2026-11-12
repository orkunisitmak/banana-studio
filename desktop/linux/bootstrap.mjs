import { localOrigin } from './security.mjs';

// Runs only in the shell/main process. Never pass the launch credential to a renderer.
export async function bootstrapSession(origin, bootstrap, cookies, { signal, timeout = 10000 } = {}) {
  if (!localOrigin(origin) || !/^[a-f0-9]{64}$/.test(bootstrap)) throw new Error('Local workspace authentication failed.');
  const response = await fetch(`${origin}/local/bootstrap`, {
    headers: { 'X-Banana-Bootstrap': bootstrap }, redirect: 'manual',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  try {
    const parts = response.headers.get('set-cookie')?.split(';').map(part => part.trim());
    const name = 'banana_' + bootstrap.slice(0, 12);
    if (response.status !== 303 || response.headers.get('location') !== '/' ||
        parts?.[0] !== `${name}=${bootstrap}` ||
        !['httponly', 'samesite=strict', 'path=/'].every(attribute => parts.slice(1).some(part => part.toLowerCase() === attribute))) {
      throw new Error('Local workspace authentication failed.');
    }
    await cookies.set({ url: origin, name, value: bootstrap, httpOnly: true, sameSite: 'strict', path: '/' });
  } finally { await response.body?.cancel(); }
}
