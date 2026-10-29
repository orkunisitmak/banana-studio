import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Cpu, HardDrive, KeyRound, Lock, Route, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import { TextModelSettings } from './TextModelSettings';
import { ProviderRoutingSettings } from './ProviderRoutingSettings';
import { LocalModelSettings, useLocalServerStatus } from './LocalModelSettings';
import { BudgetSettings } from './BudgetWarning';
import { MyUsage } from './MyUsage';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { postNativeAction } from '../../desktop/shared/nativeBridge';

type TabId = 'text' | 'local' | 'routing' | 'usage';
const TABS: { id: TabId; label: string; hint: string; icon: LucideIcon }[] = [
  { id: 'text', label: 'Text model', hint: 'Enhance & Brainstorm', icon: Cpu },
  { id: 'local', label: 'Local models', hint: 'Text, image & video', icon: HardDrive },
  { id: 'routing', label: 'Providers', hint: 'Routing per model', icon: Route },
  { id: 'usage', label: 'Usage', hint: 'Spending & warnings', icon: BarChart3 },
];
const TAB_KEY = 'banana-ai-settings-tab';
const readTab = (): TabId => {
  try { const value = localStorage.getItem(TAB_KEY); return TABS.some(tab => tab.id === value) ? value as TabId : 'text'; } catch { return 'text'; }
};

/** Header trigger: a compact pill that reads as the studio's control center. */
export function AISettingsButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick}
    className="group flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] py-1.5 pl-1.5 pr-3.5 font-medium text-gray-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-violet-400/40 hover:text-white hover:shadow-[0_0_0_3px_rgba(139,92,246,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-[0_0_12px_rgba(168,85,247,0.45)]" aria-hidden="true">
      <SlidersHorizontal size={13} />
    </span>
    AI settings
  </button>;
}

export function AISettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const [tab, setTab] = useState<TabId>(readTab);
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tab]));
  const local = isLocalWorkspace();
  const status = useLocalServerStatus(open ? 1 : 0);
  const configured = Object.values(status).filter(value => value != null).length;
  const online = Object.values(status).filter(Boolean).length;

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) { element.showModal(); tabRefs.current[tab]?.focus(); }
    if (!open && element?.open) element.close();
    if (!open) setVisited(new Set([tab]));
  }, [open]);
  const select = (next: TabId, focus = false) => {
    setTab(next);
    setVisited(current => current.has(next) ? current : new Set([...current, next]));
    try { localStorage.setItem(TAB_KEY, next); } catch { /* Remembering the tab is optional. */ }
    if (focus) tabRefs.current[next]?.focus();
  };
  // Roving focus: arrows move between tabs in either orientation, Home/End jump to the ends.
  const onTabKey = (event: React.KeyboardEvent) => {
    const index = TABS.findIndex(item => item.id === tab);
    const next = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (next == null) return;
    event.preventDefault();
    select(TABS[(next + TABS.length) % TABS.length].id, true);
  };

  return <dialog ref={dialog} aria-labelledby="ai-settings-title" aria-describedby="ai-settings-subtitle"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    className="h-[min(88vh,780px)] w-[calc(100%-2rem)] max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#0e1319] p-0 text-white shadow-[0_30px_120px_-20px_rgba(0,0,0,0.9)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
    <div className="relative flex h-full flex-col">
      {/* Soft studio glow behind the header. */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-violet-600/20 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-40 h-64 w-64 rounded-full bg-lime-400/10 blur-3xl" />

      <header className="relative flex items-center gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_0_24px_rgba(168,85,247,0.4)]" aria-hidden="true">
          <SlidersHorizontal size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ai-settings-title" className="text-base font-semibold tracking-tight">AI settings</h2>
          <p id="ai-settings-subtitle" className="truncate text-xs text-gray-400">Models, local servers, provider routing and spending</p>
        </div>
        <button type="button" aria-label="Close AI settings" onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
          <X size={18} />
        </button>
      </header>

      {/* minmax(0,1fr) keeps the scrolling tab strip from widening the column on phones. */}
      <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] md:grid-cols-[236px_minmax(0,1fr)] md:grid-rows-1">
        <nav className="min-w-0 border-b border-white/[0.07] md:flex md:flex-col md:border-b-0 md:border-r md:p-3" aria-label="AI settings sections">
          <div role="tablist" aria-orientation="vertical" aria-label="AI settings" onKeyDown={onTabKey}
            className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:overflow-visible md:p-0">
            {TABS.map(item => {
              const selected = item.id === tab;
              const Icon = item.icon;
              return <button key={item.id} ref={element => { tabRefs.current[item.id] = element; }} type="button" role="tab" id={`ai-tab-${item.id}`}
                aria-selected={selected} aria-controls={`ai-panel-${item.id}`} tabIndex={selected ? 0 : -1} onClick={() => select(item.id)}
                className={`group relative flex shrink-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  selected ? 'bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'}`}>
                {selected && <span aria-hidden="true" className="absolute inset-y-2 left-0 hidden w-[3px] rounded-full bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.7)] md:block" />}
                <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition ${
                  selected ? 'border-violet-400/40 bg-violet-500/15 text-violet-200' : 'border-white/[0.06] bg-white/[0.03] text-gray-400 group-hover:text-gray-200'}`}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0 md:flex-1">
                  <span className="block whitespace-nowrap text-sm font-medium">{item.label}</span>
                  <span className="hidden truncate text-[11px] text-gray-500 md:block">{item.hint}</span>
                </span>
                {item.id === 'local' && configured > 0 && <span className={`shrink-0 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${online ? 'bg-lime-400/15 text-lime-300' : 'bg-white/[0.06] text-gray-400'}`}>
                  {online}/{configured}<span className="sr-only"> local servers online</span>
                </span>}
              </button>;
            })}
          </div>
          <div className="mt-auto hidden space-y-2 p-2 md:block">
            {local && <button type="button" onClick={() => postNativeAction('keys')}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-400/25 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-500/20">
              <KeyRound size={13} aria-hidden="true" />Provider keys
            </button>}
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-500">
              <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{local ? 'Keys stay in this computer’s secure vault.' : 'Provider keys stay on the server.'}
            </p>
          </div>
        </nav>

        <div className="min-h-0 min-w-0 overflow-y-auto">
          {/* Visited panels stay mounted (hidden) so unsaved choices survive tab switches; closing the dialog resets them. */}
          {TABS.filter(item => open && visited.has(item.id)).map(item => <section key={item.id} id={`ai-panel-${item.id}`} role="tabpanel"
            aria-labelledby={`ai-tab-${item.id}`} hidden={item.id !== tab} tabIndex={0}
            className="px-5 py-5 focus-visible:outline-none sm:px-7 sm:py-6 [&>*:first-child]:mt-0 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
            {item.id === 'text' && <TextModelSettings />}
            {item.id === 'local' && <LocalModelSettings />}
            {item.id === 'routing' && <ProviderRoutingSettings />}
            {item.id === 'usage' && <><MyUsage /><BudgetSettings /></>}
          </section>)}
        </div>
      </div>
    </div>
  </dialog>;
}
