import React from 'react';
import { useTranslation } from '../lib/i18n';

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
      <button
        type="button"
        title={t('nav.languageTurkish', 'Turkish')}
        aria-label={t('nav.languageTurkish', 'Turkish')}
        aria-pressed={language === 'tr'}
        onClick={() => setLanguage('tr')}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-all ${
          language === 'tr'
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <span aria-hidden="true">🇹🇷</span>
        <span>TR</span>
      </button>
      <button
        type="button"
        title={t('nav.languageEnglish', 'English')}
        aria-label={t('nav.languageEnglish', 'English')}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-all ${
          language === 'en'
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <span aria-hidden="true">🇬🇧</span>
        <span>EN</span>
      </button>
    </div>
  );
}
