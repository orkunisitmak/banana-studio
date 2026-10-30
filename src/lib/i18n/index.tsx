import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { initialLanguage, LANGUAGE_STORAGE_KEY, translate, validLanguage } from './messages';
import type { Language, MessageKey } from './messages';
type I18n = { language: Language; setLanguage: (value: Language) => void; t: (key: MessageKey, values?: Record<string, string | number>) => string; saving: boolean; saveFailed: boolean };
const Context = createContext<I18n | null>(null);
function storage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; } }
export function I18nProvider({children}: {children: React.ReactNode}) {
  const config = typeof window === 'undefined' ? undefined : window.__BANANA_STUDIO_CONFIG__;
  const local = config?.mode === 'local';
  const [language, updateLanguage] = useState<Language>(() => initialLanguage(storage(), typeof navigator === 'undefined' ? 'en' : navigator.language,
    config?.mode === 'local' ? config.language : undefined));
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const setLanguage = useCallback((value: Language) => {
    if (!validLanguage(value)) return;
    updateLanguage(value);
    let cacheSaved = false;
    try { const target = storage(); target?.setItem(LANGUAGE_STORAGE_KEY, value); cacheSaved = !!target; } catch { /* Local backend can still persist it. */ }
    if (!local) { setSaveFailed(!cacheSaved); return; }
    const current = ++revision.current;
    setSaving(true); setSaveFailed(false);
    // Preserve click order so a slow older write cannot replace the latest choice.
    pending.current = pending.current.catch(() => {}).then(async () => {
      const response = await fetch('/local/query', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rpc: 'save_interface_language', args: {p_language: value}}), signal: AbortSignal.timeout(10_000)});
      const result = await response.json();
      if (!response.ok || result.error || result.data !== value) throw new Error('Language preference could not be saved.');
    }).then(() => { if (current === revision.current) {setSaving(false);setSaveFailed(false);} }, () => {
      if (current === revision.current) {setSaving(false);setSaveFailed(true);}
    });
  }, [local]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === LANGUAGE_STORAGE_KEY && validLanguage(event.newValue)) updateLanguage(event.newValue); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => translate(language, key, values), [language]);
  const value = useMemo(() => ({language, setLanguage, t, saving, saveFailed}), [language, setLanguage, t, saving, saveFailed]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
}
