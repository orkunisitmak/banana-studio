import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Settings, X, Command } from 'lucide-react';
import { TextModelSettings } from './TextModelSettings';
import { ProviderRoutingSettings } from './ProviderRoutingSettings';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import type { UserProfile } from '../types';
import { postNativeAction } from '../../desktop/shared/nativeBridge';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ShortcutsModal } from './ShortcutsModal';
import { useTranslation } from '../lib/i18n';

export function WorkspaceBar({ profile, onOpenAdmin, onSignOut }: { profile: UserProfile | null; onOpenAdmin: () => void; onSignOut: () => Promise<void> }) {
  const local = isLocalWorkspace();
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (settingsOpen && element && !element.open) element.showModal();
    if (!settingsOpen && element?.open) element.close();
  }, [settingsOpen]);

  // Global shortcut listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle shortcuts with '?' when not in an input/textarea
      const target = e.target as HTMLElement;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (e.key === '?' && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return <>
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-[#0d1117] px-5 py-2.5 text-xs">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-white tracking-wide">🍌 Banana Studio</span>
        <span className="text-gray-500">
          {local ? t('app.localWorkspace', 'Local workspace · This computer') : profile?.display_name || t('app.yourWorkspace', 'Your workspace')}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />

        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          title={t('nav.shortcuts', 'Keyboard Shortcuts')}
          className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-gray-400 hover:bg-white/5 hover:text-gray-200 transition-colors"
        >
          <Command size={13} />
          <span className="hidden sm:inline font-medium">{t('nav.shortcuts', 'Shortcuts')}</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-gray-300 hover:bg-white/5 transition-colors"
        >
          <Settings size={14} />
          {t('nav.aiSettings', 'AI settings')}
        </button>

        {!local && profile?.role === 'admin' && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="rounded-lg px-3 py-2 text-violet-300 hover:bg-white/5 transition-colors"
          >
            {t('nav.workspaceAdmin', 'Workspace admin')}
          </button>
        )}

        {!local && (
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/5 transition-colors"
          >
            {t('nav.signOut', 'Sign out')}
          </button>
        )}

        {local && (
          <button
            type="button"
            onClick={() => postNativeAction('keys')}
            className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-violet-300 hover:bg-violet-500/20 transition-colors"
          >
            <KeyRound size={14} />
            {t('nav.providerKeys', 'Provider keys')}
          </button>
        )}
      </div>
    </header>

    <dialog
      ref={dialog}
      onCancel={event => { event.preventDefault(); setSettingsOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}
      aria-labelledby="local-ai-settings"
      className="max-h-[85vh] w-[calc(100%-3rem)] max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#161b22] p-0 text-white backdrop:bg-black/75 shadow-2xl"
    >
      <section className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 id="local-ai-settings" className="text-lg font-semibold">{t('nav.aiSettings', 'AI settings')}</h2>
          <button autoFocus type="button" aria-label="Close AI settings" onClick={() => setSettingsOpen(false)}>
            <X size={20} />
          </button>
        </div>
        {settingsOpen && <><TextModelSettings /><ProviderRoutingSettings /></>}
      </section>
    </dialog>

    <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
  </>;
}
