import React, { useEffect, useState } from 'react';
import { MODEL_ROUTES, PROVIDER_LABELS, resolveProvider, type AIProvider, type ProviderAvailability, type ProviderChoice, type ProviderSettings } from '../lib/providers';
import { getProviderAvailability, readProviderSettings, saveProviderPreference, saveWorkspaceProviderPolicy } from '../services/providerRouting';
import { Dropdown } from './ControlDropdown';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import { IMAGE_MODEL_OPTIONS, VIDEO_MODEL_OPTIONS, TEXT_MODEL_OPTIONS } from '../types';

const EVENT = 'banana-provider-routes-changed';
const MODELS: Record<string,string> = Object.fromEntries(
  [...IMAGE_MODEL_OPTIONS,...VIDEO_MODEL_OPTIONS,...TEXT_MODEL_OPTIONS].map(({value,label}) => [value,label]),
);
interface SettingsSnapshot extends ProviderSettings { loading: boolean; userId?: string; error?: string }
const emptySettings: ProviderSettings = {preferences:{},personal:{},policy:{},canManage:false};
interface AvailabilitySnapshot { available: ProviderAvailability; error?: string }
interface ModelRoute extends AvailabilitySnapshot { model:string; choice:ProviderChoice; personal:ProviderChoice; policy?:ProviderChoice; provider?:AIProvider; userId?:string }
export function useProviderPreferences(): SettingsSnapshot {
  const [state,setState] = useState<SettingsSnapshot>({ ...emptySettings,loading:true });
  useEffect(() => {
    let active = true, revision = 0;
    const refresh = async () => {
      const version = ++revision;
      try {
        const settings = await readProviderSettings();
        if (active && version === revision) setState({ ...settings,loading:false });
      } catch (error) {
        if (active && version === revision) setState({ ...emptySettings,loading:false,error:(error as Error).message });
      }
    };
    void refresh(); window.addEventListener(EVENT,refresh); window.addEventListener('focus',refresh);
    return () => { active = false; window.removeEventListener(EVENT,refresh); window.removeEventListener('focus',refresh); };
  },[]);
  return state;
}
export function useAvailability() {
  const [state,setState] = useState<AvailabilitySnapshot>({available:{}});
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      getProviderAvailability(signal).then(available => {
        if (!signal.aborted) setState({ available });
      }, error => { if (!signal.aborted) setState({ available:{},error:error.message }); });
    };
    refresh(); window.addEventListener('focus',refresh);
    return () => { controller.abort(); window.removeEventListener('focus',refresh); };
  },[]);
  return state;
}
function modelRoute(model: string, settings: SettingsSnapshot, availability: AvailabilitySnapshot): ModelRoute {
  const { available } = availability;
  const choice: ProviderChoice = settings.preferences[model] ?? MODEL_ROUTES[model]?.[0] ?? 'auto';
  let provider: AIProvider | undefined, error = settings.error || availability.error;
  if (choice !== 'off' && choice !== 'auto') provider = choice;
  if (!settings.loading && !error) {
    try { provider = resolveProvider(model, choice, available); }
    catch (failure) { error = (failure as Error).message; }
  }
  return { model,choice,available,provider,error,userId:settings.userId,policy:settings.policy[model],personal:settings.personal[model] ?? MODEL_ROUTES[model]?.[0] ?? 'auto' };
}
export function useProviderWorkspace(model: string) {
  const settings = useProviderPreferences(), availability = useAvailability();
  return { settings,route:modelRoute(model,settings,availability) };
}
export function useProviderRoute(model: string) {
  return useProviderWorkspace(model).route;
}
interface ControlProps { model:string; route?:ModelRoute; compact?:boolean; showError?:boolean }
export function ProviderRouteControl({model,route,...props}: ControlProps) {
  return route ? <RouteControl route={route} {...props} /> : <ConnectedRouteControl model={model} {...props} />;
}
function ConnectedRouteControl({model,...props}: Omit<ControlProps,'route'>) {
  return <RouteControl route={useProviderRoute(model)} {...props} />;
}
function RouteControl({ route, compact = false, showError = true, workspace = false }: {route: ModelRoute; compact?: boolean; showError?: boolean; workspace?:boolean}) {
  const { model } = route;
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const save = async (value: ProviderChoice | 'inherit') => {
    if (!route.userId) return;
    setSaving(true); setError('');
    try {
      if (workspace) await saveWorkspaceProviderPolicy(model,value === 'inherit' ? null : value,route.userId);
      else if (value !== 'inherit') await saveProviderPreference(model,value,route.userId);
      window.dispatchEvent(new Event(EVENT));
    }
    catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  };
  const value = workspace ? route.policy ?? 'inherit' : route.personal;
  const policyLabel = route.policy === 'off' ? 'Off' : route.policy && route.policy !== 'auto' ? PROVIDER_LABELS[route.policy] : '';
  const options = [workspace ? {value:'inherit',label:'Let people choose'} : {value:'auto',label:`Auto${route.provider && route.choice === 'auto' ? ` · ${PROVIDER_LABELS[route.provider]}` : ''}`}, {value:'off',label:'Off'},
    // Codex runs the desktop user's own CLI; hosted workspaces never offer it.
    ...(MODEL_ROUTES[model] || []).filter(provider => provider !== 'codex' || isLocalWorkspace()).map(provider => ({value:provider,label:`${PROVIDER_LABELS[provider]}${route.available[provider] ? '' : provider === 'codex' ? ' · sign-in needed' : ' · key needed'}`}))];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    {compact ? <><span className="text-gray-500">Provider</span><Dropdown label="Provider" value={value} options={options} onSelect={value => void save(value)} disabled={saving || !route.userId} compact /></> : <label className="flex items-center gap-2 text-gray-400">{workspace ? 'Workspace' : 'Provider'}
      <select aria-label={`${MODELS[model] || model} ${workspace ? 'workspace policy' : 'provider'}`} value={value} disabled={saving || !route.userId}
        className="max-w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-gray-200 focus:border-violet-400"
        onChange={event => void save(event.target.value as ProviderChoice | 'inherit')}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
    {!workspace && policyLabel && <span className="text-gray-400">Workspace policy: {policyLabel}{route.personal === 'off' && route.policy !== 'off' ? ' · personally turned off' : ''}</span>}
    {(error || showError && route.error) && <span role="status" className="text-amber-300">{error || route.error}</span>}
  </div>;
}
export function ProviderRoutingSettings() {
  const settings = useProviderPreferences(), availability = useAvailability();
  return <section className="space-y-4 border-t border-white/10 pt-5" aria-labelledby="provider-routing-title">
    <div><h3 id="provider-routing-title" className="font-semibold">Provider routing</h3>
      <p className="mt-2 text-xs leading-relaxed text-gray-400">Choose where each model runs. Off prevents new requests; a running request keeps its original provider. Auto uses the first configured provider in the list. {isLocalWorkspace() ? 'These choices stay in this desktop workspace.' : 'These choices are saved to your account.'}</p></div>
    {(settings.error || availability.error) && <p role="status" className="text-amber-300">{settings.error || availability.error}</p>}
    {Object.keys(MODELS).map(model => <div key={model}><p className="mb-1.5 text-sm text-gray-200">{MODELS[model]}</p><RouteControl route={modelRoute(model,settings,availability)} showError={false} /></div>)}
    {settings.canManage && !isLocalWorkspace() && <details className="rounded-lg border border-white/10 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Workspace policy</summary>
      <p className="my-3 text-xs text-gray-400">Apply a provider or turn a model off for everyone. Let people choose restores their saved routes. A personal Off still blocks new requests.</p>
      {Object.keys(MODELS).map(model => <div key={model} className="mb-3"><p className="mb-1 text-sm">{MODELS[model]}</p><RouteControl workspace route={modelRoute(model,settings,availability)} showError={false} /></div>)}
    </details>}
    <p className="text-xs leading-relaxed text-gray-500">Models default to fal.ai, except MAGI-2 on EvoLink. Seedance 2.5 Relaxed is available through EvoLink. YouTube lookup uses a separate YouTube Data API key. {isLocalWorkspace() && <>GPT Image 2.5 can also use your ChatGPT plan through the Codex CLI after <code>codex login</code>.</>}</p>
  </section>;
}
