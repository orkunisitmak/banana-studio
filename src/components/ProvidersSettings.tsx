import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, KeyRound, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { MODEL_ROUTES, PROVIDER_KEYS, PROVIDER_LABELS, type AIProvider, type KeyedProvider, type LocalAgentProvider } from '../lib/providers';
import { getProviderStatus, type LocalAgentStatus, type ProviderStatus } from '../services/providerStatus';
import { NATIVE_KEYS_CHANGED, hasNativeShell, postNativeAction, type NativeKeyAccount } from '../../desktop/shared/nativeBridge';
import { MODELS } from './ProviderRoutingSettings';
import { BRAND_PATHS } from './providerMarks';

export const PROVIDERS_CHANGED = 'banana-provider-routes-changed';
type Tone = 'ready' | 'action' | 'off';
interface Brand { icon?: keyof typeof BRAND_PATHS; monogram?: string; tile: string; glyph: string }
const AGENTS: { id: LocalAgentProvider; name: string; plan: string; brand: Brand; install: string; login: string }[] = [
  { id: 'claude-code', name: 'Claude Code', plan: 'Claude Pro or Max', brand: { icon: 'claude', tile: 'bg-[#d97757]/15', glyph: 'fill-[#d97757]' }, install: 'npm install -g @anthropic-ai/claude-code', login: 'claude auth login' },
  { id: 'codex', name: 'Codex', plan: 'ChatGPT Plus, Pro or Business', brand: { monogram: '>_', tile: 'bg-white/10', glyph: 'text-white' }, install: 'npm install -g @openai/codex', login: 'codex login' },
  { id: 'gemini-cli', name: 'Gemini CLI', plan: 'Google account', brand: { icon: 'gemini', tile: 'bg-[#8e75b2]/15', glyph: 'fill-[#a891d0]' }, install: 'npm install -g @google/gemini-cli', login: 'gemini' },
  { id: 'opencode', name: 'opencode', plan: 'OpenCode account', brand: { icon: 'opencode', tile: 'bg-white/10', glyph: 'fill-white' }, install: 'npm install -g opencode-ai', login: 'opencode auth login' },
];
const KEYED: { id: KeyedProvider | 'youtube'; blurb: string; brand: Brand; console: string }[] = [
  { id: 'openrouter', blurb: 'One key for text, images and video', brand: { icon: 'openrouter', tile: 'bg-indigo-400/15', glyph: 'fill-indigo-300' }, console: 'https://openrouter.ai/settings/keys' },
  { id: 'openai', blurb: 'GPT Image and GPT text', brand: { monogram: 'AI', tile: 'bg-emerald-400/15', glyph: 'text-emerald-300' }, console: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', blurb: 'Nano Banana, Gemini text and video analysis', brand: { icon: 'gemini', tile: 'bg-sky-400/15', glyph: 'fill-sky-300' }, console: 'https://aistudio.google.com/apikey' },
  { id: 'fal', blurb: 'Image and video models, including MiniMax H3', brand: { monogram: 'fal', tile: 'bg-fuchsia-400/15', glyph: 'text-fuchsia-300' }, console: 'https://fal.ai/dashboard/keys' },
  { id: 'evolink', blurb: 'Seedance video, including the Relaxed tier', brand: { monogram: 'EV', tile: 'bg-amber-400/15', glyph: 'text-amber-300' }, console: 'https://evolink.ai' },
  { id: 'youtube', blurb: 'Channel and video lookup for briefs', brand: { icon: 'youtube', tile: 'bg-red-500/15', glyph: 'fill-red-400' }, console: 'https://console.cloud.google.com/apis/credentials' },
];
const servedModels = (provider: AIProvider) => Object.entries(MODEL_ROUTES).filter(([, routes]) => routes.includes(provider)).map(([model]) => (MODELS[model] || model).split(' · ')[0]);

const Mark: React.FC<{ brand: Brand }> = ({ brand }) => <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ring-white/10 ${brand.tile}`}>
  {brand.icon ? <svg viewBox="0 0 24 24" className={`h-4 w-4 ${brand.glyph}`}><path d={BRAND_PATHS[brand.icon]} /></svg>
    : <span className={`font-mono text-[11px] font-bold tracking-tight ${brand.glyph}`}>{brand.monogram}</span>}
</span>;
const Dot: React.FC<{ tone: Tone }> = ({ tone }) => <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'ready' ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60' : tone === 'action' ? 'bg-amber-300' : 'bg-gray-600'}`} />;
const Models: React.FC<{ provider: AIProvider }> = ({ provider }) => {
  const models = servedModels(provider);
  return <span title={models.join(', ')} className="hidden shrink-0 rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-gray-400 md:inline">{models.length === 1 ? models[0] : `${models.length} models`}</span>;
};
const Command: React.FC<{ value: string }> = ({ value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* Clipboard unavailable; the command stays selectable. */ } };
  return <div className="flex items-center gap-2 rounded-md border border-white/[0.07] bg-black/40 py-1 pl-2.5 pr-1 font-mono text-[12px] text-gray-200">
    <Terminal size={12} className="shrink-0 text-gray-500" /><code className="min-w-0 flex-1 select-all truncate">{value}</code>
    <button type="button" onClick={() => void copy()} aria-label={`Copy ${value}`} className="rounded p-1 text-gray-400 hover:bg-white/10 hover:text-white">{copied ? <Check size={12} /> : <Copy size={12} />}</button>
  </div>;
};

export const agentState = (status: LocalAgentStatus | undefined): { tone: Tone; label: string } => {
  if (!status) return { tone: 'off', label: 'Checking…' };
  if (status.disabled) return { tone: 'off', label: 'Turned off' };
  if (!status.installed) return { tone: 'off', label: 'Not installed' };
  if (status.auth === 'signed-in') return { tone: 'ready', label: 'Connected' };
  if (status.auth === 'api-key') return { tone: 'action', label: 'Signed in with an API key' };
  return { tone: 'action', label: 'Sign-in needed' };
};

const Row: React.FC<{ brand: Brand; name: string; tone: Tone; status: string; detail?: string; provider?: AIProvider; action?: React.ReactNode; children?: React.ReactNode }> = ({ brand, name, tone, status, detail, provider, action, children }) =>
  <li className="px-3.5 py-3">
    <div className="flex items-center gap-3">
      <Mark brand={brand} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        <p className="flex items-center gap-1.5 truncate text-[12px] text-gray-400"><Dot tone={tone} /><span className={tone === 'ready' ? 'text-emerald-300' : tone === 'action' ? 'text-amber-200' : ''}>{status}</span>{detail && <span className="truncate text-gray-500">· {detail}</span>}</p>
      </div>
      {provider && <Models provider={provider} />}
      {action}
    </div>
    {children && <div className="mt-2.5 space-y-1.5 pl-11">{children}</div>}
  </li>;

const AgentRow: React.FC<{ agent: typeof AGENTS[number]; status?: LocalAgentStatus }> = ({ agent, status }) => {
  const state = agentState(status);
  const needsSetup = !!status && !status.disabled && status.auth !== 'signed-in';
  const [open, setOpen] = useState(false);
  const detail = status?.available ? [status.authMethod, status.version && `v${status.version}`].filter(Boolean).join(' · ') : status?.installed && status.version ? `v${status.version}` : `Uses your ${agent.plan} plan`;
  return <Row brand={agent.brand} name={agent.name} tone={state.tone} status={state.label} detail={detail} provider={agent.id}
    action={needsSetup && <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-gray-200 hover:bg-white/5">
      {status?.installed ? 'Sign in' : 'Set up'}<ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} /></button>}>
    {needsSetup && open && <>
      <p className="text-[12px] text-gray-400">{status?.installed ? status.auth === 'api-key' ? 'This CLI uses an API key. Sign in with your plan instead:' : 'Run once in Terminal, then finish in your browser:' : 'Install the CLI, then sign in:'}</p>
      {!status?.installed && <Command value={agent.install} />}<Command value={agent.login} />
    </>}
  </Row>;
};

const KeyRow: React.FC<{ provider: typeof KEYED[number]; configured: boolean; disabled?: boolean; managed: boolean }> = ({ provider, configured, disabled, managed }) => {
  const label = provider.id === 'youtube' ? 'YouTube Data API' : PROVIDER_LABELS[provider.id];
  const account = (provider.id === 'youtube' ? 'YOUTUBE_API_KEY' : PROVIDER_KEYS[provider.id]) as NativeKeyAccount;
  return <Row brand={provider.brand} name={label} tone={disabled ? 'off' : configured ? 'ready' : 'off'} status={disabled ? 'Turned off' : configured ? 'Key saved' : 'No key'} detail={provider.blurb}
    provider={provider.id === 'youtube' ? undefined : provider.id}
    action={managed ? <span className="shrink-0 text-[11px] text-gray-500">Server managed</span> : <div className="flex shrink-0 items-center gap-1">
      {!configured && <a href={provider.console} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300">Get key ↗</a>}
      <button type="button" onClick={() => postNativeAction('keys', account)} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${configured ? 'border-white/10 text-gray-300 hover:bg-white/5' : 'border-violet-400/30 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'}`}>
        <KeyRound size={12} />{configured ? 'Manage' : 'Add key'}</button>
    </div>} />;
};

const Group: React.FC<{ title: string; hint: string; children: React.ReactNode }> = ({ title, hint, children }) => <div>
  <div className="mb-2 flex items-baseline justify-between gap-3"><h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</h4><span className="text-[11px] text-gray-600">{hint}</span></div>
  <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">{children}</ul>
</div>;

export function ProvidersSettings() {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  // Loads can overlap (mount, focus, key changes); only the newest may update the panel.
  const latest = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const request = ++latest.current;
    setChecking(refresh); setError('');
    try {
      const next = await getProviderStatus({ refresh });
      if (request !== latest.current) return;
      setStatus(next); window.dispatchEvent(new Event(PROVIDERS_CHANGED));
    } catch (error) { if (request === latest.current) setError((error as Error).message); }
    finally { if (request === latest.current) setChecking(false); }
  }, []);
  useEffect(() => {
    void load();
    // Re-probe on return too: a CLI is usually signed in from Terminal, then the user comes back.
    const refresh = () => void load(true);
    window.addEventListener(NATIVE_KEYS_CHANGED, refresh); window.addEventListener('focus', refresh);
    return () => { window.removeEventListener(NATIVE_KEYS_CHANGED, refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  const managed = !status?.local || !hasNativeShell();
  const connected = status ? Object.values(status.keys as Record<string, { configured: boolean; disabled: boolean }>).filter(key => key.configured && !key.disabled).length
    + Object.values(status.agents as Record<string, LocalAgentStatus>).filter(agent => agent?.available).length : 0;
  return <section aria-labelledby="providers-title" className="space-y-6">
    <div className="flex items-start justify-between gap-4 pr-8">
      <div><h3 id="providers-title" className="font-semibold">Providers</h3>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{status ? <><span className="text-gray-200">{connected} connected.</span> </> : ''}Connect only what you use. Keys stay in your {status?.local ? 'system keychain' : 'server environment'} and never reach this page.</p></div>
      <button type="button" onClick={() => void load(true)} disabled={checking} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-60">
        {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Check again</button>
    </div>
    {error && <p role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">{error}</p>}
    {!status && !error && <p className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" />Checking providers…</p>}
    {status?.local && <div className="space-y-2">
      <Group title="Local agents" hint="Your subscription · no API key">{AGENTS.map(agent => <AgentRow key={agent.id} agent={agent} status={status.agents[agent.id]} />)}</Group>
      <p className="text-[11px] leading-relaxed text-gray-500">Banana Studio runs the CLI already on this computer, with every tool turned off, in an empty folder. It never reads or stores the CLI's sign-in. Requests count toward your plan's usage limits.</p>
    </div>}
    {status && <Group title="API keys" hint="Pay per use">
      {KEYED.map(provider => <KeyRow key={provider.id} provider={provider}
        configured={provider.id === 'youtube' ? status.youtube.configured : !!status.keys[provider.id]?.configured}
        disabled={provider.id === 'youtube' ? false : !!status.keys[provider.id]?.disabled} managed={managed} />)}
    </Group>}
  </section>;
}
