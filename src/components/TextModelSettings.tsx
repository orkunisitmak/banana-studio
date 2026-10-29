import { isLocalWorkspace } from '../lib/config/runtimeConfig';
import React, { useEffect, useState } from 'react';
import { Cpu, Loader2, RefreshCw } from 'lucide-react';
import { TEXT_MODEL_OPTIONS } from '../types';
import { OLLAMA_TEXT_MODEL, OPENAI_TEXT_MODEL, getOllamaModel, setOllamaModel, getTextModel, getOpenAIReasoningEffort, getGeminiThinkingLevel, GEMINI_THINKING_LEVELS, type GeminiThinkingLevel, type LocalTextServer } from '../lib/prompts/textModels';
import { DEFAULT_OPENAI_REASONING, OPENAI_REASONING_EFFORTS, type OpenAIReasoningEffort } from '../lib/prompts/openaiText';
import { DEFAULT_OPENROUTER_REASONING, OPENROUTER_TEXT_MODEL, OPENROUTER_REASONING_EFFORTS } from '../lib/prompts/openrouterText';
import { listOllamaModels, type OllamaModels } from '../services/ollamaService';
import { useProviderRoute } from './ProviderRoutingSettings';
import { loadTextPreferences, saveTextPreferences, type SavedTextPreferences, type TextPreferenceScope } from '../services/textPreferencesService';

export const TextModelSettings: React.FC = () => {
  const [selectedModel, setSelectedModel] = useState(getTextModel);
  const [reasoningEffort, setReasoningEffort] = useState(getOpenAIReasoningEffort);
  const [thinkingLevel, setThinkingLevel] = useState(getGeminiThinkingLevel);
  const [saved, setSaved] = useState<SavedTextPreferences | null>(null);
  const [busy, setBusy] = useState<'loading' | TextPreferenceScope | null>('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  // Each server keeps its own model choice, so nothing is listed or saved until the route is known.
  const textRoute = useProviderRoute(OLLAMA_TEXT_MODEL);
  const localServer: LocalTextServer | null = !textRoute.loaded ? null
    : textRoute.choice === 'ollama' || textRoute.choice === 'openaicompat' ? textRoute.choice
    : textRoute.provider === 'openaicompat' ? 'openaicompat' : 'ollama';
  const [localModel, setLocalModel] = useState('');
  useEffect(() => { if (localServer) setLocalModel(getOllamaModel(localServer)); }, [localServer]);
  const [installed, setInstalled] = useState<OllamaModels | null>(null);
  const [installedError, setInstalledError] = useState('');
  const [installedReload, setInstalledReload] = useState(0);
  const local = selectedModel === OLLAMA_TEXT_MODEL;
  useEffect(() => {
    if (!local || !localServer) return;
    const controller = new AbortController();
    setInstalledError('');
    listOllamaModels(controller.signal, localServer).then(setInstalled)
      .catch(error => { if (!controller.signal.aborted) { setInstalled(null); setInstalledError(error instanceof Error ? error.message : 'Ollama is unavailable.'); } });
    return () => controller.abort();
  }, [local, installedReload, localServer]);
  const apply = (value: SavedTextPreferences) => {
    setSaved(value); setSelectedModel(value.preferredModel || value.model); setThinkingLevel(value.thinkingLevel); setReasoningEffort(value.reasoningEffort);
  };
  useEffect(() => {
    let active = true;
    setBusy('loading'); setError('');
    loadTextPreferences().then(value => { if (active) apply(value); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Unable to load settings.'); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [reload]);
  const save = async (scope: TextPreferenceScope) => {
    setBusy(scope); setError(''); setMessage('');
    try {
      if (local) {
        if (!localServer) throw new Error('Wait for the local server route to load, then save again.');
        setOllamaModel(localModel, localServer);
      }
      apply(await saveTextPreferences(scope, { model: selectedModel, thinkingLevel, reasoningEffort }));
      setMessage(isLocalWorkspace() ? 'Saved on this computer. New requests will use these settings.' : scope === 'all' ? 'Saved for all users. New requests will use these settings.' : 'Saved for your account on all devices.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save settings.'); }
    finally { setBusy(null); }
  };
  const changed = () => { setMessage(''); setError(''); };

  return (
    <fieldset className="min-w-0 mb-6" disabled={!!busy} aria-busy={!!busy}>
      <legend className="flex items-center gap-2 mb-1 text-sm font-semibold text-white">
        <Cpu className="w-4 h-4 text-violet-400" aria-hidden="true" />
        AI Text Model
      </legend>
      <p className="text-xs text-gray-500 mb-4">
        Used for Enhance, Brainstorm, variations and the final YouTube video brief. Gemini reads the footage first. Changes apply after saving; running requests keep their settings.
      </p>
      <div className="space-y-2">
        {TEXT_MODEL_OPTIONS.map(option => (
          <label key={option.value} className={`flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-violet-400 ${
            selectedModel === option.value
              ? 'bg-violet-600/10 border-violet-500/50 text-white'
              : 'bg-gray-900/50 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200'
          }`}>
            <input
              type="radio" name="text-model" value={option.value}
              checked={selectedModel === option.value}
              onChange={() => { setSelectedModel(option.value); changed(); }}
              className="mt-1 h-3.5 w-3.5 shrink-0 accent-violet-500"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-gray-400">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      {local && (
        <div className="mt-4 text-sm text-gray-300">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ollama-model">Installed model · {!localServer ? 'checking server…' : localServer === 'ollama' ? 'Ollama' : 'LM Studio / OpenAI-compatible'}</label>
            <button type="button" onClick={() => setInstalledReload(value => value + 1)} aria-label="Refresh Ollama models"
              className="flex items-center gap-1 rounded-lg border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-600"><RefreshCw className="h-3 w-3" aria-hidden="true" />Refresh</button>
          </div>
          <select id="ollama-model" value={localModel} disabled={!localServer} onChange={event => { setLocalModel(event.target.value); changed(); }}
            className="mt-2 block w-full rounded-xl border border-gray-700 bg-gray-900 p-3 text-base sm:text-sm text-white outline-none focus:border-violet-400">
            <option value="">{installed?.defaultModel ? `Server default · ${installed.defaultModel}` : 'Choose a model'}</option>
            {[...new Set([...(installed?.models || []), ...(localModel ? [localModel] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <span className="mt-2 block text-xs leading-relaxed text-gray-500">Saved on this device. Install models with <code>ollama pull qwen3:8b</code> (text) or <code>ollama pull gemma3</code> (text + image references), or load one in LM Studio and start its server. Choose the server in Provider routing. Larger models follow Brainstorm formats more reliably.</span>
          {installedError && <span role="alert" className="mt-2 block text-xs text-amber-300">{installedError}</span>}
        </div>
      )}
      {!local && selectedModel !== OPENAI_TEXT_MODEL && selectedModel !== OPENROUTER_TEXT_MODEL && (
        <label className="mt-4 block text-sm text-gray-300">
          Gemini thinking
          <select aria-label="Gemini thinking" value={thinkingLevel}
            onChange={event => { setThinkingLevel(event.target.value as GeminiThinkingLevel); changed(); }}
            className="mt-2 block w-full rounded-xl border border-gray-700 bg-gray-900 p-3 text-base sm:text-sm text-white outline-none focus:border-violet-400">
            {GEMINI_THINKING_LEVELS.map(value => <option key={value} value={value}>{({ LOW: 'Low', MEDIUM: 'Medium · Default', HIGH: 'High' })[value]}</option>)}
          </select>
          <span className="mt-2 block text-xs leading-relaxed text-gray-500">Higher thinking gives complex briefs more reasoning time.</span>
        </label>
      )}
      {(selectedModel === OPENAI_TEXT_MODEL || selectedModel === OPENROUTER_TEXT_MODEL) && (
        <label className="mt-4 block text-sm text-gray-300">
          {selectedModel === OPENROUTER_TEXT_MODEL ? 'Opus 5.5 thinking' : 'GPT-6.1 Sol reasoning'}
          <select aria-label={selectedModel === OPENROUTER_TEXT_MODEL ? 'Opus 5.5 thinking' : 'GPT-6.1 Sol reasoning'} value={reasoningEffort}
            onChange={event => { setReasoningEffort(event.target.value as OpenAIReasoningEffort); changed(); }}
            className="mt-2 block w-full rounded-xl border border-gray-700 bg-gray-900 p-3 text-base sm:text-sm text-white outline-none focus:border-violet-400">
            {(selectedModel === OPENROUTER_TEXT_MODEL ? OPENROUTER_REASONING_EFFORTS : OPENAI_REASONING_EFFORTS).map(value => <option key={value} value={value}>{({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' })[value]}{value === (selectedModel === OPENROUTER_TEXT_MODEL ? DEFAULT_OPENROUTER_REASONING : DEFAULT_OPENAI_REASONING) ? ' · Default' : ''}</option>)}
          </select>
          <span className="mt-2 block text-xs leading-relaxed text-gray-500">High gives briefs more reasoning time. Lower levels respond faster; higher levels may take longer. Applies to new requests.</span>
        </label>
      )}
      {saved && <p className="mt-4 text-xs text-gray-400">{isLocalWorkspace() ? 'Settings are saved on this computer.' : `Currently using ${saved.source === 'personal' ? 'your personal settings' : 'settings saved for all users'}.`}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={!saved || !!busy || (local && !localServer)} onClick={() => void save('me')}
          className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">
          {busy === 'me' && <Loader2 className="h-4 w-4 animate-spin" />}{isLocalWorkspace() ? 'Save on this computer' : 'Save for me'}
        </button>
        {!isLocalWorkspace() && saved?.canSaveAll && <button type="button" disabled={!!busy} onClick={() => void save('all')}
          className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/40 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-500/10 disabled:opacity-50">
          {busy === 'all' && <Loader2 className="h-4 w-4 animate-spin" />}Save for all
        </button>}
        {!saved && !busy && <button type="button" onClick={() => setReload(value => value + 1)} className="rounded-xl border border-gray-700 px-4 py-2.5 text-sm text-white">Retry</button>}
      </div>
      {!isLocalWorkspace() && saved?.canSaveAll && <p className="mt-2 text-xs leading-relaxed text-gray-500">Save for me affects only your account. Save for all replaces everyone’s current choices, including personal settings. A later personal save can override it.</p>}
      {busy === 'loading' && <p role="status" className="mt-3 text-sm text-gray-400">Loading saved settings…</p>}
      {message && <p role="status" className="mt-3 text-sm text-green-300">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </fieldset>
  );
};
