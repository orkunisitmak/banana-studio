import { useEffect, useRef } from 'react';

/** Must be called from a user gesture so browsers keep the permission prompt. */
export const requestNotificationPermission = (): void => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  try {
    void Promise.resolve(Notification.requestPermission()).catch(() => {
      // Notifications are optional; a denied or unavailable permission must not
      // interrupt generation.
    });
  } catch {
    // Older Safari can throw synchronously instead of returning a promise.
  }
};

/** Sends one neutral browser notification when a generation batch finishes. */
export const useJobNotifications = (activeRequests: number) => {
  const previous = useRef(activeRequests);

  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    if (previous.current > 0 && activeRequests === 0 && Notification.permission === 'granted') {
      try {
        new Notification('Banana Studio', { body: 'Your generation batch finished.' });
      } catch {
        // Some platforms (Android Chrome) only allow service-worker notifications.
      }
    }
    previous.current = activeRequests;
  }, [activeRequests]);
};
