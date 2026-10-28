import React, { useEffect, useState } from 'react';
import { useTranslation } from '../lib/i18n';
import { browserIsOffline } from '../lib/networkStatus';

export function NetworkStatus() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(() => browserIsOffline(typeof navigator === 'undefined' ? undefined : navigator.onLine));

  useEffect(() => {
    const update = () => setOffline(browserIsOffline(navigator.onLine));
    window.addEventListener('offline', update);
    window.addEventListener('online', update);
    update();
    return () => {
      window.removeEventListener('offline', update);
      window.removeEventListener('online', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" aria-live="polite" className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-950/80 px-3 py-2 text-sm text-amber-100">
      <span>{t('app.offline', 'You are offline. Saved work remains available, but new requests will wait until your connection returns.')}</span>
      <button
        type="button"
        className="shrink-0 rounded-md border border-amber-300/30 px-2 py-1 font-medium hover:bg-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
        onClick={() => {
          window.dispatchEvent(new Event('online'));
          window.dispatchEvent(new Event('banana:retry-network'));
          setOffline(false);
        }}
      >
        {t('app.retryConnection', 'Retry connection')}
      </button>
    </div>
  );
}
