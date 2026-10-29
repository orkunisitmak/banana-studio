import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { translations, Language } from './translations';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, fallback?: string) => string;
}

const STORAGE_KEY = 'banana_studio_language';

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'tr' || stored === 'en') return stored;
    } catch {
      // Ignore localStorage read errors in restricted contexts
    }
    // Detect from the browser even when localStorage is unavailable.
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('tr')) {
      return 'tr';
    }
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore
    }
  };

  const t = useMemo(() => {
    return (path: string, fallback?: string): string => {
      const parts = path.split('.');
      let current: any = translations[language];
      for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          // Fallback to English if missing in current language
          let enFallback: any = translations.en;
          for (const fallbackPart of parts) {
            if (enFallback && typeof enFallback === 'object' && fallbackPart in enFallback) {
              enFallback = enFallback[fallbackPart];
            } else {
              enFallback = undefined;
              break;
            }
          }
          return typeof enFallback === 'string' ? enFallback : (fallback || path);
        }
      }
      return typeof current === 'string' ? current : (fallback || path);
    };
  }, [language]);

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    // Graceful fallback if used outside provider
    return {
      language: 'en' as Language,
      setLanguage: () => {},
      t: (path: string, fallback?: string) => fallback || path,
    };
  }
  return context;
}
