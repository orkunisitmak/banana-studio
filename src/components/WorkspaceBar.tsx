import React, { useEffect, useRef, useState } from 'react';
import { Cpu, KeyRound, Route, Settings, X } from 'lucide-react';
import { TextModelSettings } from './TextModelSettings';
import { ProviderRoutingSettings } from './ProviderRoutingSettings';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import type { UserProfile } from '../types';
import { ProvidersSettings } from './ProvidersSettings';

type SettingsTab = 'providers' | 'routing' | 'text';
const TABS: { id: SettingsTab; label: string; icon: typeof Cpu }[] = [
  { id: 'providers', label: 'Providers', icon: KeyRound }, { id: 'routing', label: 'Routing', icon: Route }, { id: 'text', label: 'Text model', icon: Cpu },
];

export function WorkspaceBar({ profile, onOpenAdmin, onSignOut }: { profile: UserProfile | null; onOpenAdmin: () => void; onSignOut: () => Promise<void> }) {
  const local = isLocalWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>('providers');
  const open = (next: SettingsTab) => { setTab(next); setSettingsOpen(true); };
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
        <button type="button" onClick={() => open('routing')} className="flex items-center gap-2 rounded-lg px-3 py-2 text-gray-300 hover:bg-white/5"><Settings size={14} />AI settings</button>
        {!local && profile?.role === 'admin' && <button type="button" onClick={onOpenAdmin} className="rounded-lg px-3 py-2 text-violet-300 hover:bg-white/5">Workspace admin</button>}
        {!local && <button type="button" onClick={() => void onSignOut()} className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/5">Sign out</button>}
        <button type="button" onClick={() => open('providers')} className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-violet-300 hover:bg-violet-500/20"><KeyRound size={14} />Providers</button>
      </div>
    </header>
    <dialog ref={dialog} onCancel={event => { event.preventDefault(); setSettingsOpen(false); }} onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }} aria-labelledby="local-ai-settings" className="h-[min(85vh,760px)] w-[calc(100%-3rem)] max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#161b22] p-0 text-white shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm">
      <div className="flex h-full">
        <nav aria-label="AI settings sections" className="flex w-48 shrink-0 flex-col gap-1 border-r border-white/[0.07] bg-black/20 p-3">
          <h2 id="local-ai-settings" className="mb-3 px-2 pt-2 text-sm font-semibold">AI settings</h2>
          {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${tab === id ? 'bg-white/[0.08] text-white' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'}`}><Icon size={14} />{label}</button>)}
        </nav>
        <section key={tab} className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <button autoFocus type="button" aria-label="Close AI settings" onClick={() => setSettingsOpen(false)} className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-white/5 hover:text-white"><X size={18} /></button>
          {settingsOpen && (tab === 'providers' ? <ProvidersSettings /> : tab === 'routing' ? <ProviderRoutingSettings /> : <TextModelSettings />)}
        </section>
      </div>
    </dialog>
  </>;
}
