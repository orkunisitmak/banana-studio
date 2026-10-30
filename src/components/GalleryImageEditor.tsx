import { ProviderRouteControl, useProviderRoute } from './ProviderRoutingSettings';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getClipboardImages } from '../lib/references/clipboardImages';
import { AlertTriangle, ArrowRight, Check, Image as ImageIcon, ImagePlus, Loader2, Pencil, RotateCcw, Sparkles, Wand2, X } from 'lucide-react';
import { displayReferencePrompt, storeReferencePrompt } from '../lib/references/dynamicReferences';
import { getStableImageTag } from '../lib/references/referenceTokens';
import { validateImageGenerationReferences } from '../lib/images/imagePrompting';
import { getImageCostPreview } from '../lib/images/imageCostPreview';
import { getOpenAIImageOptions, SUNBURST_MODEL, SUNBURST_QUALITY_OPTIONS, validateOpenAIImageSize } from '../lib/images/openaiImage';
import { isValidEditRegion, type ImageEditRegion } from '../lib/images/imageEditRegion';
import { enhancePrompt } from '../services/geminiService';
import { resolveTextModelPreferences } from '../lib/prompts/textModels';
import { createPromptPreparation } from '../lib/prompts/promptPreparation';
import { getPromptEnhancementTarget, IMAGE_MODEL_OPTIONS, isEnhancedPromptStale, type GeneratedMedia, type GenerationConfig, type ImageModelId, type OpenAIImageOptions, type ReferenceImage, type TextModelId } from '../types';
import { getGalleryEditJobs, getEditJobProgress } from '../lib/gallery/galleryEditJobs';
import { GalleryEditResults } from './GalleryEditResults';
import { ImageEditCanvas } from './ImageEditCanvas';
import { ImageEditComparison } from './ImageEditComparison';
import { Dropdown } from './ControlDropdown';
import { ImageCountControl, PROMPT_PANEL_CLASS, PROMPT_INPUT_CLASS, PROMPT_TEXTAREA_CLASS, PROMPT_TOOLBAR_CLASS, PROMPT_SETTINGS_CLASS, PROMPT_ACTIONS_CLASS, PROMPT_REVERT_CLASS, promptResizeClass, promptEnhanceClass, promptGenerateClass } from './PromptComposerUI';
import { buildGalleryImageEditConfig, canUseNanoEditCanvas, getEditSource, getGalleryEditReferenceLimit, readGalleryEditReference } from './galleryImageEdit';

interface GalleryImageEditorProps {
  image: GeneratedMedia;
  images?: GeneratedMedia[];
  isEditing: boolean;
  onStart: () => void;
  onGenerate: (config: GenerationConfig) => Promise<string[]>;
  onEditResult?: (image: GeneratedMedia) => void;
  onClose: () => void;
  initialTextModel?: TextModelId;
  refreshSource?: (media: GeneratedMedia) => Promise<string>;
}

/** Selected-area editor for a gallery image: mask, references, prompt and queued results. */
export const GalleryImageEditor: React.FC<GalleryImageEditorProps> = ({ image, images = [], isEditing, onStart, onGenerate, onClose, onEditResult, initialTextModel, refreshSource }) => {
  const [region, setRegion] = useState<ImageEditRegion>();
  const [canvas, setCanvas] = useState<{ width: number; height: number }>();
  const [prompt, setPrompt] = useState('');
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [mention, setMention] = useState<{ start: number; end: number; query: string }>();
  const [mentionIndex, setMentionIndex] = useState(0);
  const [imageModel, setImageModel] = useState<ImageModelId>(SUNBURST_MODEL);
  const providerRoute = useProviderRoute(imageModel);
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<OpenAIImageOptions['quality']>(() => getOpenAIImageOptions(image.openaiImageOptions).quality);
  const [previewId, setPreviewId] = useState<string>();
  const [lastQueuedIds, setLastQueuedIds] = useState<string[]>([]);
  const [enhancement, setEnhancement] = useState<Partial<GenerationConfig>>({});
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStarted, setGenerationStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptHeight, setPromptHeight] = useState(96);
  const [isResizingPrompt, setIsResizingPrompt] = useState(false);
  const promptResizeRef = useRef<{ pointerId: number; lastY: number } | null>(null);
  const busyRef = useRef(false);
  const enhancementAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef<number | undefined>(undefined);
  const resultsRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const source = useMemo(() => getEditSource(image, region), [image.id, image.url, image.openaiImageOptions?.outputFormat, region]);
  const hasArea = isValidEditRegion(region);
  const baseConfig = hasArea && canvas ? buildGalleryImageEditConfig(image, prompt, imageModel, count, canvas, region!, references) : undefined;
  const config = baseConfig ? { ...baseConfig, openaiImageOptions: { ...baseConfig.openaiImageOptions!, quality }, ...enhancement } : undefined;
  const editReferences = baseConfig?.referenceImages || [source, ...references];
  const displayPrompt = displayReferencePrompt(prompt, editReferences);
  const referenceLimit = getGalleryEditReferenceLimit(imageModel);
  let referenceError: string | null = references.length > referenceLimit ? `This model supports ${referenceLimit} added references. Remove a reference or choose GPT Image 2.5.` : null;
  if (config && !referenceError) {
    try { validateImageGenerationReferences(config); }
    catch (failure) { referenceError = failure instanceof Error ? failure.message : 'Check the references in your prompt.'; }
  }
  const mentionOptions = editReferences.map((reference, index) => ({
    reference, label: index === 0 ? 'Edit source · Reference 1' : `Reference ${index + 1}`,
    text: displayReferencePrompt(getStableImageTag(reference.id), editReferences),
    aliases: `REF_IMAGE_${index + 1} ref_${index + 1} ref${index + 1}`,
  })).filter(option => !mention || `${option.label} ${option.text} ${option.aliases}`.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase()));
  const mentionListId = `edit-reference-mentions-${image.id}`;
  const jobs = useMemo(() => getGalleryEditJobs(image.id, images), [image.id, images]);
  const preview = jobs.find(job => job.id === previewId && !getEditJobProgress(job).pending && !getEditJobProgress(job).failed && job.url);
  const isStale = config ? isEnhancedPromptStale(config) : false;
  const busy = isEnhancing || isGenerating || isUploading;
  const nanoCanvasSupported = canvas ? canUseNanoEditCanvas(canvas) : true;
  const canvasError = canvas ? imageModel === SUNBURST_MODEL ? validateOpenAIImageSize(`${canvas.width}x${canvas.height}`)
    : !nanoCanvasSupported ? 'Choose GPT Image 2.5 to keep this canvas.' : null : null;
  const canGenerate = !providerRoute.error && !busy && !preview && !!prompt.trim() && !!config && !isStale && !canvasError && !referenceError;
  const imageCostPreview = config ? getImageCostPreview({ ...config, imageProvider: providerRoute.provider }) : undefined;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; enhancementAbortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (hasArea && isEditing) promptRef.current?.focus({ preventScroll: true });
  }, [hasArea, isEditing]);
  useEffect(() => {
    // Keep the mobile composer in view for repeated submissions. On desktop,
    // reveal the result strip within the independently scrolling image pane.
    if (lastQueuedIds.length && window.innerWidth >= 768) resultsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lastQueuedIds]);
  useEffect(() => {
    if (previewId) previewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [previewId]);
  useEffect(() => {
    // A chip can replace an existing mention with the same stored token, so
    // caret restoration must also run when only the selection state changes.
    if (pendingCaretRef.current == null) return;
    promptRef.current?.focus({ preventScroll: true });
    promptRef.current?.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    pendingCaretRef.current = undefined;
  });

  const changePrompt = (value: string) => {
    setPrompt(value); setEnhancement({}); setError(null); setGenerationStarted(false);
  };

  const handlePromptChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    changePrompt(storeReferencePrompt(value, editReferences));
    const cursor = event.target.selectionStart ?? value.length;
    const match = value.slice(0, cursor).match(/(?:^|\s)@([^@\s]*)$/);
    setMention(match ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] } : undefined);
    setMentionIndex(0);
  };

  const insertMention = (text: string) => {
    const start = mention?.start ?? promptRef.current?.selectionStart ?? displayPrompt.length;
    const end = mention?.end ?? promptRef.current?.selectionEnd ?? start;
    const value = `${displayPrompt.slice(0, start)}${text} ${displayPrompt.slice(end)}`;
    pendingCaretRef.current = start + text.length + 1;
    changePrompt(storeReferencePrompt(value, editReferences));
    setMention(undefined);
  };

  const addReferences = async (files: File[]) => {
    if (!files.length || busyRef.current || preview) return;
    if (files.length > referenceLimit - references.length) { setError(`You can add ${Math.max(0, referenceLimit - references.length)} more reference images with this model.`); return; }
    busyRef.current = true; setIsUploading(true); setError(null); setMention(undefined);
    try {
      const added = await Promise.all(files.map(readGalleryEditReference));
      if (mountedRef.current) { setReferences(current => [...current, ...added]); setGenerationStarted(false); }
    } catch (failure) {
      if (mountedRef.current) setError(failure instanceof Error ? failure.message : 'Could not upload references.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsUploading(false);
    }
  };

  const clampPromptHeight = (height: number) => Math.max(96, Math.min(600, typeof window === 'undefined' ? 600 : Math.max(96, window.innerHeight - 280), height));
  const finishPromptResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (promptResizeRef.current?.pointerId !== event.pointerId) return;
    promptResizeRef.current = null; setIsResizingPrompt(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const handleEnhance = async () => {
    if (!config || referenceError || !prompt.trim() || busyRef.current) return;
    busyRef.current = true; setIsEnhancing(true); setError(null);
    const controller = new AbortController(); enhancementAbortRef.current = controller;
    const brief = config.originalPrompt ?? prompt;
    try {
      const preferences = await resolveTextModelPreferences();
      const textOptions = {
        model: initialTextModel || preferences.model, thinkingLevel: preferences.thinkingLevel,
        reasoningEffort: preferences.reasoningEffort, signal: controller.signal,
      };
      const result = await enhancePrompt(brief, config.referenceImages, config, textOptions);
      if (!result || controller.signal.aborted || !mountedRef.current) return;
      setPrompt(result);
      setEnhancement({ originalPrompt: brief, ...getPromptEnhancementTarget(config), promptPreparation: createPromptPreparation('enhance', textOptions) });
    } catch (failure) {
      if (!controller.signal.aborted && mountedRef.current) setError(failure instanceof Error ? failure.message : 'Could not enhance the edit prompt.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsEnhancing(false);
      if (enhancementAbortRef.current === controller) enhancementAbortRef.current = null;
    }
  };

  const handleGenerate = async () => {
    if (!config || !prompt.trim() || busyRef.current) return;
    if (referenceError) { setError(referenceError); return; }
    if (canvasError) { setError(canvasError); return; }
    if (isStale) { setError('References or model changed. Enhance again or revert to your original prompt.'); return; }
    busyRef.current = true; setIsGenerating(true); setError(null); setGenerationStarted(false);
    try {
      const ids = await onGenerate(config);
      if (mountedRef.current) { setLastQueuedIds(ids); setGenerationStarted(true); }
    } catch (failure) {
      if (mountedRef.current) setError(failure instanceof Error ? failure.message : 'Could not generate the edit.');
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setIsGenerating(false);
    }
  };

  if (!isEditing) return <div className="mt-4 flex w-full max-w-5xl items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#161b22] px-4 py-3" data-gallery-edit-controller>
    <div className="flex min-w-0 items-center gap-2.5 text-sm text-gray-300"><Pencil className="h-4 w-4 shrink-0 text-lime-400" /><span className="truncate">Change part of this image</span></div>
    <button type="button" onClick={onStart} aria-label="Edit this image" className="flex shrink-0 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400">Edit image <ArrowRight className="h-3.5 w-3.5" /></button>
  </div>;

  return <section className="w-full min-w-0 shrink-0 space-y-3" aria-label="Edit image" aria-busy={busy} data-gallery-image-editor onClick={event => event.stopPropagation()} onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (canGenerate) void handleGenerate(); }
  }}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-100"><Pencil className="h-4 w-4 text-lime-400" /> Edit image <span className="hidden text-xs font-normal text-gray-500 sm:inline">Only the masked area changes</span></div>
      <button type="button" onClick={onClose} disabled={busy} aria-label="Close image edit" className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-40"><X className="h-4 w-4" /></button>
    </div>
    {preview && <div ref={previewRef} className="space-y-3" data-edit-result-preview>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400"><span>Edited result</span><div className="flex gap-2">
        <button type="button" onClick={() => setPreviewId(undefined)} className="rounded-xl bg-white/[0.06] px-3 py-2 font-medium text-white hover:bg-white/10">Back to editing source</button>
        {onEditResult && <button type="button" onClick={() => onEditResult(preview)} className="flex items-center gap-1.5 rounded-xl bg-lime-400/10 px-3 py-2 font-medium text-lime-300 hover:bg-lime-400/20"><Pencil className="h-3.5 w-3.5" />Edit this result</button>}
      </div></div>
      <ImageEditComparison source={image} result={preview} refreshSource={refreshSource}
        normalResult={<div className="flex items-center justify-center"><img src={preview.url} alt={preview.prompt} className="h-auto max-h-[65dvh] max-w-full rounded-2xl object-contain md:max-h-[calc(100dvh-170px)]" /></div>} />
      <p className="px-1 text-xs text-gray-500">Your source, selections and prompt are kept. Choose “Edit this result” to start a new edit from this image.</p>
    </div>}
    <div inert={busy || undefined} className={preview ? 'hidden' : busy ? 'pointer-events-none opacity-70' : undefined}>
      <ImageEditCanvas source={source} region={region} onChange={next => { if (busyRef.current) return; setRegion(next); setError(null); setGenerationStarted(false); }} onCanvasLoad={next => setCanvas(next.width > 0 && next.height > 0 ? next : undefined)} maxHeight={null} imageClassName="max-h-[65dvh] md:max-h-[calc(100dvh-170px)]" />
    </div>
    {hasArea ? <div className={`${PROMPT_PANEL_CLASS} rounded-[1.6rem] border border-white/[0.09] ${preview ? 'hidden' : ''}`} data-gallery-edit-prompt>
      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/[0.06] px-3 py-3 sm:px-4" data-edit-reference-tray>
        <input ref={referenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" aria-label="Upload edit reference files" disabled={busy} onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const files = Array.from<File>(event.currentTarget.files || []);
          event.currentTarget.value = '';
          void addReferences(files);
        }} />
        <button type="button" onClick={() => referenceInputRef.current?.click()} disabled={busy || references.length >= referenceLimit} aria-label="Upload edit references" title="Add reference images for this edit" className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-700 text-gray-400 transition-colors hover:border-violet-400 hover:bg-violet-500/10 hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40">
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}<span className="text-[9px] font-bold uppercase tracking-wider">Ref</span>
        </button>
        {references.map((reference, index) => <div key={reference.id} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-700" data-edit-reference={reference.id}>
          <button type="button" disabled={busy} aria-label={`Insert Reference ${index + 2}`} title={`Insert ${displayReferencePrompt(getStableImageTag(reference.id), editReferences)}`} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(displayReferencePrompt(getStableImageTag(reference.id), editReferences))} className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400">
            <img src={reference.data} alt={`Reference ${index + 2}`} className="h-full w-full object-cover" />
            <span className="absolute bottom-0 inset-x-0 bg-black/70 px-1 py-0.5 text-center text-[9px] font-semibold text-white">Ref {index + 2}</span>
          </button>
          <button type="button" disabled={busy} aria-label={`Remove Reference ${index + 2}`} onClick={() => { setReferences(current => current.filter(ref => ref.id !== reference.id)); setMention(undefined); setError(null); setGenerationStarted(false); }} className="absolute right-0 top-0 grid h-6 w-6 place-items-center rounded-full bg-black/75 text-gray-200 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-40"><X className="h-3 w-3" /></button>
        </div>)}
        {!references.length && <p className="px-1 text-xs text-gray-500">Add reference images for the selected area.</p>}
      </div>
      <div className={PROMPT_INPUT_CLASS}>
        <button type="button" aria-label="Resize edit prompt field" title="Drag up or down to resize the prompt" disabled={busy} className={promptResizeClass(isResizingPrompt)} aria-valuemin={96} aria-valuemax={600} aria-valuenow={Math.round(promptHeight)}
          onPointerDown={event => {
            if (busyRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
            promptResizeRef.current = { pointerId: event.pointerId, lastY: event.clientY }; setIsResizingPrompt(true);
          }}
          onPointerMove={event => {
            const resize = promptResizeRef.current;
            if (!resize || resize.pointerId !== event.pointerId) return;
            event.preventDefault(); const delta = resize.lastY - event.clientY; resize.lastY = event.clientY;
            setPromptHeight(current => clampPromptHeight(current + delta));
          }} onPointerUp={finishPromptResize} onPointerCancel={finishPromptResize} onLostPointerCapture={finishPromptResize}
          onKeyDown={event => { if (!busy && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); event.stopPropagation(); setPromptHeight(current => clampPromptHeight(current + (event.key === 'ArrowUp' ? 24 : -24))); } }}>
          <span className="h-1 w-12 rounded-full bg-current shadow-sm transition-colors" />
        </button>
        <textarea ref={promptRef} value={displayPrompt} onChange={handlePromptChange} disabled={busy} aria-label="Edit prompt" aria-autocomplete="list" aria-controls={mention ? mentionListId : undefined} aria-activedescendant={mention && mentionOptions.length ? `${mentionListId}-${mentionOptions[mentionIndex % mentionOptions.length].reference.id}` : undefined} placeholder="What would you like to change? Type @ to use a reference." spellCheck={false} className={PROMPT_TEXTAREA_CLASS} style={{ height: `${promptHeight}px`, minHeight: '96px', maxHeight: 'min(600px, calc(100dvh - 17.5rem))', outline: 'none', boxShadow: 'none' }}
          onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const files = getClipboardImages(event.clipboardData);
            if (files.length) { event.preventDefault(); void addReferences(files); }
          }}
          onKeyDown={event => {
            if (!mention || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(undefined); return; }
            if (!mentionOptions.length) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); event.stopPropagation();
              setMentionIndex(current => (current + (event.key === 'ArrowDown' ? 1 : mentionOptions.length - 1)) % mentionOptions.length);
            } else if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault(); event.stopPropagation(); insertMention(mentionOptions[mentionIndex % mentionOptions.length].text);
            }
          }} />
        {mention && <div id={mentionListId} role="listbox" aria-label="Edit image references" className="absolute inset-x-3 bottom-full z-50 mb-2 max-h-60 overflow-y-auto rounded-xl border border-gray-700 bg-[#1c2128] shadow-2xl sm:left-4 sm:right-auto sm:w-72">
          {mentionOptions.length ? mentionOptions.map((option, index) => <button key={option.reference.id} id={`${mentionListId}-${option.reference.id}`} type="button" role="option" aria-selected={index === mentionIndex % mentionOptions.length} onMouseDown={event => event.preventDefault()} onClick={() => insertMention(option.text)} className={`flex w-full items-center gap-3 p-2 text-left text-sm transition-colors ${index === mentionIndex % mentionOptions.length ? 'bg-violet-600/20 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
            <img src={option.reference.data} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" /><span className="min-w-0 truncate">{option.label}<span className="ml-2 text-[10px] text-gray-400">{option.text}</span></span>
          </button>) : <p className="p-3 text-xs text-gray-400">No matching reference.</p>}
        </div>}
      </div>
      <div className="px-4 py-2"><ProviderRouteControl model={imageModel} compact /></div>
      <div className={PROMPT_TOOLBAR_CLASS}>
        <div className={PROMPT_SETTINGS_CLASS} role="group" aria-label="Edit settings">
          <Dropdown label="Edit model" value={imageModel} options={IMAGE_MODEL_OPTIONS.map(model => ({ ...model, disabled: model.value !== SUNBURST_MODEL && (!nanoCanvasSupported || references.length > getGalleryEditReferenceLimit(model.value)) }))} onSelect={value => { if (busyRef.current) return; setImageModel(value as ImageModelId); setError(null); setGenerationStarted(false); }} icon={ImageIcon} compact disabled={busy} />
          {imageModel === SUNBURST_MODEL && <Dropdown label="Quality" value={quality} options={SUNBURST_QUALITY_OPTIONS} onSelect={(value: OpenAIImageOptions['quality']) => { if (!busyRef.current) setQuality(value); }} icon={Sparkles} compact disabled={busy} />}
          <ImageCountControl count={count} onChange={value => { if (!busyRef.current) { setCount(value); setGenerationStarted(false); } }} disabled={busy} />
        </div>
        <div className={PROMPT_ACTIONS_CLASS}>
          {enhancement.originalPrompt != null && <button type="button" disabled={busy} onClick={() => { setPrompt(enhancement.originalPrompt!); setEnhancement({}); setError(null); }} className={PROMPT_REVERT_CLASS} aria-label="Revert edit prompt" title="Restore the brief before Enhance"><RotateCcw className="w-4 h-4" /><span>Revert</span></button>}
          <button type="button" onClick={() => { setMention(undefined); void handleEnhance(); }} disabled={busy || !prompt.trim() || !canvas || !!referenceError} className={promptEnhanceClass(isEnhancing, false)} aria-label="Enhance edit prompt" title={isEnhancing ? 'Enhancing...' : 'Enhance prompt'}>{isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}</button>
          <button type="button" onClick={() => void handleGenerate()} disabled={!canGenerate} className={promptGenerateClass(canGenerate)} aria-label="Generate image edit" title={isStale ? 'Enhance again or revert to your original prompt for the selected model.' : imageCostPreview?.description}>
            <div className="relative z-10 flex flex-col items-center gap-0.5 leading-tight">
              {isGenerating ? <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-200"><Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" />Adding to queue…</span> : <>
                <span className="flex items-center gap-1.5 whitespace-nowrap text-xs">{isStale ? 'Re-enhance required' : 'Generate image'}{isStale ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 shrink-0 fill-black" />}</span>
                {!isStale && imageCostPreview && <span className="whitespace-nowrap text-[10px] font-medium opacity-80">{imageCostPreview.label}</span>}
              </>}
            </div>
          </button>
        </div>
      </div>
    </div> : !preview && <p className="px-1 text-xs text-gray-500">Draw around the part you want to edit. Then describe your change below.</p>}
    {isStale && <p role="status" className="px-1 text-xs text-amber-300">References or model changed. Enhance again or revert before generating.</p>}
    {referenceError && <p role="status" className="px-1 text-xs text-amber-300">{referenceError}</p>}
    {canvasError && <p role="status" className="px-1 text-xs text-amber-300">{canvasError}</p>}
    {canvas && !nanoCanvasSupported && !canvasError && <p className="px-1 text-[11px] text-gray-500">GPT Image 2.5 keeps this canvas. Nano Banana needs a standard image ratio.</p>}
    {error && <p role="alert" className="px-1 text-xs text-red-400">{error}</p>}
    {generationStarted && <p role="status" className="flex items-center gap-1.5 px-1 text-xs text-lime-300"><Check className="h-3.5 w-3.5" /> {lastQueuedIds.length} image{lastQueuedIds.length === 1 ? '' : 's'} added to the queue.</p>}
    <div ref={resultsRef}><GalleryEditResults source={image} jobs={jobs} selectedId={preview?.id} onSelect={id => setPreviewId(id)} /></div>
  </section>;
};
