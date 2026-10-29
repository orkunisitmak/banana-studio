import React, { useEffect, useState } from 'react';
import { MODEL_ROUTES, PROVIDER_LABELS, resolveProvider, type AIProvider, type ProviderAvailability, type ProviderChoice } from '../lib/providers';
import { getProviderAvailability, getProviderPreferences, saveProviderPreference } from '../services/providerRouting';
import { Dropdown } from './ControlDropdown';
import { isLocalWorkspace } from '../lib/config/runtimeConfig';

const EVENT = 'banana-provider-routes-changed';
const MODELS: Record<string,string> = {
  'gpt-image-2.5-sunburst':'GPT Image 2.5', 'gemini-3-pro-image-preview':'Nano Banana Pro', 'gemini-nano-banana-2.1':'Nano Banana 2.1',
  'anthropic/claude-opus-5.5':'Claude Opus 5.5', 'gpt-6.1-sol':'GPT-6.1 Sol', 'gemini-3.8-flash':'Gemini 3.8 Flash · text / video analysis',
  'seedance-2.0':'Seedance 2.0', 'seedance-2.5':'Seedance 2.5', 'minimax-h3':'MiniMax H3 Max',
};
export function useProviderRoute(model: string) {
  const [state,setState] = useState<{ model:string; provider?:AIProvider; choice:ProviderChoice; available:ProviderAvailability; error?:string }>({ model:'',choice:'auto',available:{} });
  useEffect(() => {
    let active = true, revision = 0;
    const refresh = async () => {
      const version = ++revision;
      try {
        const [available, preferences] = await Promise.all([getProviderAvailability(),getProviderPreferences()]);
        if (!active || version !== revision) return;
        const choice = preferences[model] || 'auto';
        try { setState({ model,choice,available,provider:resolveProvider(model,choice,available) }); }
        catch (error) { setState({ model,choice,available, ...(choice !== 'auto' && MODEL_ROUTES[model]?.includes(choice) ? {provider:choice} : {}), error:(error as Error).message }); }
      } catch (error) { if (active && version === revision) setState({ model,choice:'auto',available:{},error:(error as Error).message }); }
    };
    void refresh(); window.addEventListener(EVENT,refresh); window.addEventListener('focus',refresh);
    return () => { active = false; window.removeEventListener(EVENT,refresh); window.removeEventListener('focus',refresh); };
  },[model]);
  return state.model === model ? state : { model,choice:'auto' as const,available:{} };
}
export function ProviderRouteControl({ model, compact = false, showError = true }: { model:string; compact?:boolean; showError?:boolean }) {
  const route = useProviderRoute(model);
  const [saving,setSaving] = useState(false), [error,setError] = useState('');
  const save = async (value: ProviderChoice) => {
    setSaving(true); setError('');
    try { await saveProviderPreference(model,value); window.dispatchEvent(new Event(EVENT)); }
    catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  };
  const options = [{value:'auto',label:`Auto${route.provider && route.choice === 'auto' ? ` · ${PROVIDER_LABELS[route.provider]}` : ''}`},
    // Codex runs the desktop user's own CLI; hosted workspaces never offer it.
    ...(MODEL_ROUTES[model] || []).filter(provider => provider !== 'codex' || isLocalWorkspace()).map(provider => ({value:provider,label:`${PROVIDER_LABELS[provider]}${route.available[provider] ? '' : provider === 'codex' ? ' · sign-in needed' : ' · key needed'}`}))];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
    {compact ? <><span className="text-gray-500">Provider</span><Dropdown label="Provider" value={route.choice} options={options} onSelect={value => void save(value)} disabled={saving} compact /></> : <label className="flex items-center gap-2 text-gray-400">Provider
      <select aria-label={`${MODELS[model] || model} provider`} value={route.choice} disabled={saving}
        className="max-w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-gray-200 focus:border-violet-400"
        onChange={event => void save(event.target.value as ProviderChoice)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>}
    {(error || showError && route.error) && <span role="status" className="text-amber-300">{error || route.error}</span>}
  </div>;
}
export function ProviderRoutingSettings() {
  return <section className="space-y-4 border-t border-white/10 pt-5" aria-labelledby="provider-routing-title">
    <div><h3 id="provider-routing-title" className="font-semibold">Provider routing</h3>
      <p className="mt-2 text-xs leading-relaxed text-gray-400">Add only the keys you need. Auto uses the first configured provider shown for each model. A running request keeps its provider and is never resubmitted to a different service. These route preferences are saved on this device.</p></div>
    {Object.keys(MODELS).map(model => <div key={model}><p className="mb-1.5 text-sm text-gray-200">{MODELS[model]}</p><ProviderRouteControl model={model} showError={false} /></div>)}
    <p className="text-xs leading-relaxed text-gray-500">fal.ai covers image/video models; Enhance and Brainstorm require OpenRouter, OpenAI or Gemini. YouTube lookup uses a separate YouTube Data API key. H3 Max requires fal.ai. Seedance 2.5 Relaxed is an EvoLink option; other routes use standard Seedance 2.5. In the desktop app, GPT Image 2.5 can also use your ChatGPT plan through the Codex CLI after <code>codex login</code>, with no API key.</p>
  </section>;
}
