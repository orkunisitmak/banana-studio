import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserProfile } from '../types';
import { checkUserAuthorization, getProfile, getSession, onAuthStateChange, signOut } from '../services/authService';
import { clearLocalMediaCache } from '../services/storageService';
import { isTransientReadError } from '../lib/shared/transientRead';
import { LoginScreen, LoginNotice } from './LoginScreen';

type Access = { userId: string; profile: UserProfile | null };

/** The workspace is mounted only after a verified active allowlist check. */
export function AuthBoundary({ children }: {
  children: (access: Access, onSignOut: () => Promise<void>) => React.ReactNode;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const identity = useRef<string | null>(null);
  // The user whose workspace is currently open, if any.
  const verified = useRef<string | null>(null);
  const retry = useRef<() => void>(() => {});
  const revision = useRef(0);
  const signingOut = useRef(false);
  const cacheCleanup = useRef<Promise<void>>(Promise.resolve());

  const forgetIdentity = useCallback(() => {
    const previousId = identity.current;
    identity.current = null;
    verified.current = null;
    setAccess(null);
    cacheCleanup.current = cacheCleanup.current
      .then(() => clearLocalMediaCache(previousId || undefined))
      .catch(() => { /* User-scoped storage still prevents cross-account reads. */ });
  }, []);

  const handleSignOut = useCallback(async () => {
    signingOut.current = true;
    revision.current += 1;
    forgetIdentity();
    setLoading(false);
    setNotice(null);
    try {
      await signOut();
      signingOut.current = false;
    } catch {
      // Keep the workspace closed even if the remote logout request fails.
      setNotice('signout-failed');
    }
  }, [forgetIdentity]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const isCurrent = (check: number) => !disposed && revision.current === check && !signingOut.current;

    const verify = async (providedSession?: Session | null) => {
      if (signingOut.current) return;
      const check = ++revision.current;
      checking = true;
      try {
        const session = providedSession === undefined ? await getSession() : providedSession;
        if (!isCurrent(check)) return;
        const userId = session?.user.id || null;
        if (userId !== identity.current) {
          forgetIdentity();
          identity.current = userId;
          setLoading(!!userId);
        }
        if (!userId) {
          forgetIdentity();
          setLoading(false);
          return;
        }
        const authorization = await checkUserAuthorization(userId);
        if (!isCurrent(check)) return;
        if (authorization === 'unavailable') {
          // A network blip is not a denial. An open workspace stays open (server
          // routes and RLS still enforce access) and the next refresh retries;
          // first entry waits on a retryable message instead of "not authorized".
          if (verified.current !== userId) {
            setNotice('unavailable');
            setLoading(false);
          }
          return;
        }
        if (authorization === 'unauthorized') {
          forgetIdentity();
          setNotice('unauthorized');
          setLoading(false);
          return;
        }
        // undefined = the read failed: keep the role already verified for this
        // user (periodic refresh) instead of treating it as "no profile".
        const profile = await getProfile().catch(() => undefined);
        if (!isCurrent(check)) return;
        // Another identity cannot supply this workspace's profile/admin role.
        if (profile && profile.id !== userId) throw new Error('Session changed');
        await cacheCleanup.current;
        if (!isCurrent(check)) return;
        identity.current = userId;
        verified.current = userId;
        setAccess(previous => ({ userId, profile: profile !== undefined ? profile : previous?.userId === userId ? previous.profile : null }));
        setNotice(null);
        setLoading(false);
      } catch (error) {
        if (!isCurrent(check)) return;
        // A failed session read is a blip too: keep an open workspace and retry
        // on the next refresh. First entry still fails closed, with a retryable
        // message instead of "not authorized".
        const transient = isTransientReadError(error);
        if (transient && verified.current && verified.current === identity.current) return;
        forgetIdentity();
        setNotice(transient ? 'unavailable' : 'unauthorized');
        setLoading(false);
      } finally {
        if (revision.current === check) checking = false;
      }
    };

    void verify();
    const { data: { subscription } } = onAuthStateChange((session, event) => {
      if (event === 'INITIAL_SESSION') return;
      // Invalidate async checks and hide the old account synchronously. Supabase
      // auth callbacks must not await auth calls while its session lock is held.
      revision.current += 1;
      checking = false;
      if (!session || session.user.id !== identity.current) {
        forgetIdentity();
        setLoading(!!session);
      }
      const scheduledRevision = revision.current;
      window.setTimeout(() => {
        if (isCurrent(scheduledRevision)) void verify(session);
      }, 0);
    });
    const refresh = () => {
      if (!checking && document.visibilityState !== 'hidden') void verify();
    };
    retry.current = refresh;
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      disposed = true;
      revision.current += 1;
      subscription.unsubscribe();
      window.clearInterval(interval);
      retry.current = () => {};
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [forgetIdentity]);

  if (loading) return <div className="h-screen w-screen bg-[#0d1117] flex items-center justify-center"><div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!access) return <LoginScreen notice={notice} onRetry={() => retry.current()} />;
  return <>{children(access, handleSignOut)}</>;
}
