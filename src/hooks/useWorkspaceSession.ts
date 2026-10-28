import { useCallback, useEffect, useRef } from 'react';
import { getSession } from '../services/authService';

/**
 * Keeps every workspace write tied to the verified session that started it.
 * The returned wrappers re-check the session before and after each operation.
 */
export const useWorkspaceSession = (userId: string) => {
  const workspaceActive = useRef(true);

  useEffect(() => {
    workspaceActive.current = true;
    return () => {
      workspaceActive.current = false;
    };
  }, []);

  const assertWorkspaceSession = useCallback(async () => {
    const session = await getSession();
    if (!workspaceActive.current || session?.user.id !== userId) {
      throw new Error('Session changed. Sign in again to continue.');
    }
  }, [userId]);

  const withWorkspaceSession = useCallback(
    <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
      async (...args: Args): Promise<Result> => {
        await assertWorkspaceSession();
        const result = await operation(...args);
        await assertWorkspaceSession();
        return result;
      },
    [assertWorkspaceSession],
  );

  return { workspaceActive, assertWorkspaceSession, withWorkspaceSession };
};
