import React from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider,useI18n} from '../../src/lib/i18n';
import {LanguageSwitcher} from '../../src/components/LanguageSwitcher';
import {LANGUAGE_STORAGE_KEY} from '../../src/lib/i18n/messages';
function Fixture(){const {language,saving,saveFailed,t}=useI18n();return <main><h1>Local desktop language acceptance</h1><p>Only a temporary synthetic local workspace. No accounts or provider calls.</p><LanguageSwitcher/><h2>{t('generateImage')}</h2><pre aria-label="Persistence state">{JSON.stringify({origin:location.origin,language,saving,saveFailed,bootstrapLanguage:window.__BANANA_STUDIO_CONFIG__?.mode==='local'?window.__BANANA_STUDIO_CONFIG__.language:null,cache:localStorage.getItem(LANGUAGE_STORAGE_KEY)})}</pre></main>;}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture/></I18nProvider>);
