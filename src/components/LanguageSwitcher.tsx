import React from 'react';
import { useI18n } from '../lib/i18n';
export function LanguageSwitcher() {
  const {language, setLanguage, t, saving, saveFailed} = useI18n();
  return <div role="group" aria-label={t('language')} className="flex shrink-0 gap-1 rounded-lg border border-white/10 p-1">
    {(['tr', 'en'] as const).map(value => <button type="button" key={value} lang={value} aria-pressed={language === value}
      onClick={() => setLanguage(value)} className={`rounded px-2 py-1 ${language === value ? 'bg-violet-500/20 text-violet-200' : 'text-gray-400 hover:bg-white/5'}`}>
      {value === 'tr' ? 'Türkçe' : 'English'}
    </button>)}
    {saving && <span role="status" className="self-center text-xs text-gray-400">{t('savingLanguage')}</span>}
    {saveFailed && <button type="button" role="alert" onClick={() => setLanguage(language)} className="max-w-64 text-xs text-amber-300" aria-label={t('retryLanguage')}>{t('languageSaveError')}</button>}
  </div>;
}
