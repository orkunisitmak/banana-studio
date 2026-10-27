import React from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

export function LanguageSwitcher() {
  const { language, setLanguage } = useTranslation();

  return (
    <div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 text-xs">
      <button
        type="button"
        title="Türkçe"
        onClick={() => setLanguage('tr')}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-all ${
          language === 'tr'
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <span>🇹🇷</span>
        <span>TR</span>
      </button>
      <button
        type="button"
        title="English"
        onClick={() => setLanguage('en')}
        className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-all ${
          language === 'en'
            ? 'bg-violet-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <span>🇬🇧</span>
        <span>EN</span>
      </button>
    </div>
  );
}
