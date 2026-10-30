import { useEffect, useRef } from 'react';

/**
 * `current` is true while the component is mounted. The effect sets it again on
 * every mount, so React.StrictMode's simulated unmount and remount leaves it true,
 * and a real unmount (for example the workspace remount on an account switch)
 * leaves it false for any handler still running from the old instance.
 */
export const useMountedRef = () => {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
};
