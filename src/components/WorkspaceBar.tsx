import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, Settings, X } from 'lucide-react';
import { TextModelSettings } from './TextModelSettings';
import { ProviderRoutingSettings } from './ProviderRoutingSettings';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import type { UserProfile } from '../types';
import { postNativeAction } from '../../desktop/shared/nativeBridge';

export function WorkspaceBar({ profile, onOpenAdmin, onSignOut }: { profile: UserProfile | null; onOpenAdmin: () => void; onSignOut: () => Promise<void> }) {
  const local = isLocalWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (settingsOpen && element && !element.open) element.showModal();
    if (!settingsOpen && element?.open) element.close();
  }, [settingsOpen]);
  return <>
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-[#0d1117] px-5 py-2.5 text-xs">
      <div><span className="font-semibold text-white">Banana Studio</span><span className="ml-3 text-gray-500">{local ? 'Local workspace · This computer' : profile?.display_name || 'Your workspace'}</span></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setSettingsOpen(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-gray-300 hover:bg-white/5"><Settings size={14} />AI settings</button>
        {!local && profile?.role === 'admin' && <button type="button" onClick={onOpenAdmin} className="rounded-lg px-3 py-2 text-violet-300 hover:bg-white/5">Workspace admin</button>}
        {!local && <button type="button" onClick={() => void onSignOut()} className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/5">Sign out</button>}
        {local && <button type="button" onClick={() => postNativeAction('keys')} className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-violet-300 hover:bg-violet-500/20"><KeyRound size={14} />Provider keys</button>}
      </div>
    </header>
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); setSettingsOpen(false); }} onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }} aria-labelledby="local-ai-settings" className="max-h-[85vh] w-[calc(100%-3rem)] max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-[#161b22] p-0 text-white backdrop:bg-black/75">
      <section className="p-6">
        <div className="mb-6 flex items-center justify-between"><h2 id="local-ai-settings" className="text-lg font-semibold">AI settings</h2><button autoFocus type="button" aria-label="Close AI settings" onClick={() => setSettingsOpen(false)}><X size={20} /></button></div>
        {settingsOpen && <><TextModelSettings /><ProviderRoutingSettings /></>}
      </section>
    </dialog>
  </>;
}
