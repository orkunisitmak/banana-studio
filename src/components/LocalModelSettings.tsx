import React, { useEffect, useState } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import { LOCAL_IMAGE_MODEL, LOCAL_SERVERS, type LocalChoice, type LocalServer } from '../lib/localModels';
import { useProviderRoute } from './ProviderRoutingSettings';
import { getLocalChoice, getLocalServerStatus, listLocalModels, setLocalChoice, type LocalModelList } from '../services/localModelsService';

type Status = Record<string, boolean | null>;
const dot = (state: boolean | null | undefined) => state ? 'bg-emerald-400' : state === false ? 'bg-amber-400' : 'bg-gray-600';
const stateLabel = (state: boolean | null | undefined) => state ? 'online' : state === false ? 'not answering' : 'not configured';

/** Polls configured local servers; null = not configured, false = configured but offline. */
export function useLocalServerStatus(refresh = 0) {
  const [status, setStatus] = useState<Status>({});
  useEffect(() => {
    const controller = new AbortController();
    const load = () => getLocalServerStatus(controller.signal).then(setStatus).catch(() => { if (!controller.signal.aborted) setStatus({}); });
    void load(); window.addEventListener('focus', load);
    return () => { controller.abort(); window.removeEventListener('focus', load); };
  }, [refresh]);
  return status;
}

/** Compact header indicator: one dot per configured local server. */
export function LocalServerIndicator() {
  const status = useLocalServerStatus();
  const configured = (Object.keys(LOCAL_SERVERS) as LocalServer[]).filter(server => status[server] != null);
  if (!configured.length) return null;
  const title = configured.map(server => `${LOCAL_SERVERS[server].label}: ${stateLabel(status[server])}`).join('\n');
  return <span role="status" title={title} aria-label={`Local servers. ${title}`} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-gray-400">
    <HardDrive size={14} aria-hidden="true" />{configured.map(server => <span key={server} className={`h-2 w-2 rounded-full ${dot(status[server])}`} />)}
  </span>;
}

const Picker = ({ id, label, choice, options, empty, hint, missing }: { id: string; label: string; choice: LocalChoice; options: string[]; empty: string; hint?: string; missing?: string }) => {
  const [value, setValue] = useState(() => getLocalChoice(choice));
  // A saved choice stays selectable, but say so when the active server does not list it.
  const unlisted = !!missing && !!value && options.length > 0 && !options.includes(value);
  return <label htmlFor={id} className="mt-3 block text-sm text-gray-300">{label}
    <select id={id} value={value} onChange={event => { setValue(event.target.value); setLocalChoice(choice, event.target.value); }}
      aria-describedby={unlisted ? `${id}-missing` : undefined}
      className="mt-1.5 block w-full rounded-xl border border-gray-700 bg-gray-900 p-2.5 text-base sm:text-sm text-white outline-none focus:border-violet-400">
      <option value="">{empty}</option>
      {[...new Set([...options, ...(value ? [value] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
    </select>
    {unlisted && <span id={`${id}-missing`} role="status" className="mt-1 block text-xs text-amber-300">{missing}</span>}
    {hint && <span className="mt-1 block text-xs leading-relaxed text-gray-500">{hint}</span>}
  </label>;
};

export function LocalModelSettings() {
  const [refresh, setRefresh] = useState(0);
  const status = useLocalServerStatus(refresh);
  const [lists, setLists] = useState<Partial<Record<'sdwebui' | 'comfyui', LocalModelList>>>({});
  useEffect(() => {
    const controller = new AbortController();
    for (const server of ['sdwebui', 'comfyui'] as const) {
      if (!status[server]) continue;
      listLocalModels(server, controller.signal).then(list => setLists(current => ({ ...current, [server]: list }))).catch(() => { /* Status shows the failure. */ });
    }
    return () => controller.abort();
  }, [status.sdwebui, status.comfyui, refresh]);
  // Checkpoint names are server-specific: list only the server Local image routes to; video always runs on ComfyUI.
  const imageRoute = useProviderRoute(LOCAL_IMAGE_MODEL).provider;
  const imageServer = imageRoute === 'sdwebui' || imageRoute === 'comfyui' ? imageRoute : null;
  const imageCheckpoints = imageServer ? lists[imageServer]?.models || [] : [];
  const comfyCheckpoints = lists.comfyui?.models || [];
  const workflows = lists.comfyui?.workflows || [];
  const folder = lists.comfyui?.workflowsDir;

  return <section className="mb-6 space-y-1 border-t border-white/10 pt-5" aria-labelledby="local-models-title">
    <div className="flex items-center justify-between gap-2">
      <h3 id="local-models-title" className="flex items-center gap-2 font-semibold"><HardDrive className="h-4 w-4 text-violet-400" aria-hidden="true" />Local models</h3>
      <button type="button" onClick={() => setRefresh(value => value + 1)} className="flex items-center gap-1 rounded-lg border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-600"><RefreshCw className="h-3 w-3" aria-hidden="true" />Refresh</button>
    </div>
    <p className="text-xs leading-relaxed text-gray-400">Run text, images and video on your own computer with no provider credits. The desktop app connects to each server’s default address; web installs set the address variables on the server. Choices here are saved on this device.</p>
    <ul className="grid grid-cols-1 gap-1.5 pt-2 text-xs sm:grid-cols-2">
      {(Object.keys(LOCAL_SERVERS) as LocalServer[]).map(server => <li key={server} className="flex items-baseline gap-2 text-gray-300">
        <span className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${dot(status[server])}`} aria-hidden="true" /><span>{LOCAL_SERVERS[server].label} <span className="text-gray-500">· {stateLabel(status[server])}</span></span>
      </li>)}
    </ul>
    <Picker id="local-image-model" label={`Image checkpoint${imageServer ? ` · ${LOCAL_SERVERS[imageServer].label}` : ''}`} choice="imageModel" options={imageCheckpoints} empty="Server default / first installed"
      missing={imageServer ? `Not installed on ${LOCAL_SERVERS[imageServer].label}; that server will reject it.` : undefined}
      hint="Used by Local · Stable Diffusion / ComfyUI. Pick the server in Provider routing." />
    <Picker id="local-image-workflow" label="Image workflow (ComfyUI)" choice="imageWorkflow" options={workflows} empty="Built-in SD / SDXL graph"
      hint="Custom workflows run Flux, SD3 or any other model your ComfyUI has." />
    <Picker id="local-video-workflow" label="Video workflow (ComfyUI)" choice="videoWorkflow" options={workflows} empty="Choose a video workflow"
      hint="Required for Local · ComfyUI workflow video, e.g. Wan or LTX-Video graphs." />
    <Picker id="local-video-model" label="Video checkpoint · ComfyUI" choice="videoModel" options={comfyCheckpoints} empty="As saved in the workflow, or the first ComfyUI checkpoint"
      missing="Not installed on ComfyUI; workflows that load it by name will fail." />
    <p className="pt-2 text-xs leading-relaxed text-gray-500">
      Export workflows with ComfyUI’s “Save (API Format)” and use placeholders such as <code>{'{{prompt}}'}</code>, <code>{'{{width}}'}</code>, <code>{'{{height}}'}</code>, <code>{'{{seed}}'}</code>, <code>{'{{checkpoint}}'}</code>, <code>{'{{image}}'}</code>, <code>{'{{mask}}'}</code>, <code>{'{{frames}}'}</code> and <code>{'{{fps}}'}</code>.
      {folder ? <> Workflow folder: <code className="break-all">{folder}</code></> : ' Set COMFYUI_WORKFLOWS_DIR on the server to add workflows.'}
    </p>
  </section>;
}
