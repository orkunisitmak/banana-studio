import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { LocalServerIndicator } from './LocalModelSettings';
import { BudgetIndicator } from './BudgetWarning';
import { AISettingsButton, AISettingsDialog } from './AISettingsDialog';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import type { UserProfile } from '../types';
import { postNativeAction } from '../../desktop/shared/nativeBridge';

export function WorkspaceBar({ profile, onOpenAdmin, onSignOut }: { profile: UserProfile | null; onOpenAdmin: () => void; onSignOut: () => Promise<void> }) {
  const local = isLocalWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <>
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-[#0d1117] px-5 py-2.5 text-xs">
      <div><span className="font-semibold text-white">Banana Studio</span><span className="ml-3 text-gray-500">{local ? 'Local workspace · This computer' : profile?.display_name || 'Your workspace'}</span></div>
      <div className="flex items-center gap-2">
        <BudgetIndicator />
        <LocalServerIndicator />
        <AISettingsButton onClick={() => setSettingsOpen(true)} />
        {!local && profile?.role === 'admin' && <button type="button" onClick={onOpenAdmin} className="rounded-lg px-3 py-2 text-violet-300 hover:bg-white/5">Workspace admin</button>}
        {!local && <button type="button" onClick={() => void onSignOut()} className="rounded-lg px-3 py-2 text-gray-400 hover:bg-white/5">Sign out</button>}
        {local && <button type="button" onClick={() => postNativeAction('keys')} className="flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-violet-300 hover:bg-violet-500/20"><KeyRound size={14} />Provider keys</button>}
      </div>
    </header>
    <AISettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </>;
}
