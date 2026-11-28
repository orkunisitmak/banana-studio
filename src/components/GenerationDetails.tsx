import React from 'react';
import { ArrowLeft, Layers, ShieldCheck, Sparkles } from 'lucide-react';
import { TEXT_MODEL_OPTIONS, type GeneratedMedia } from '../types';
import { normalizePromptPreparation } from '../lib/prompts/promptPreparation';
import { getRecordedImageEditDetails } from './recordedGenerationDetails';

const ACTION_LABELS = { enhance: 'Enhance', brainstorm: 'Brainstorm', variation: 'Variation' };
const settingLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const PromptPreparationDetails: React.FC<{ media: GeneratedMedia }> = ({ media }) => {
  const preparation = normalizePromptPreparation(media.promptPreparation);
  if (!preparation && media.originalPrompt == null) return null;
  const modelLabel = preparation && TEXT_MODEL_OPTIONS.find(option => option.value === preparation.model)?.label;
  return (
    <section aria-label="Prompt preparation" data-prompt-preparation>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-violet-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Prompt preparation</h4>
      </div>
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
        {preparation ? (
          <>
            <div className="mb-2 text-xs font-semibold text-violet-300">{ACTION_LABELS[preparation.action]}</div>
            <div className="break-words text-sm font-semibold text-white">{modelLabel || preparation.model}</div>
            {modelLabel && <div className="mt-1 break-all font-mono text-xs text-gray-500">{preparation.model}</div>}
            {preparation.reasoningEffort && <div className="mt-2 text-xs text-gray-400">Reasoning: {settingLabel(preparation.reasoningEffort)}</div>}
            {preparation.thinkingLevel && <div className="mt-2 text-xs text-gray-400">Thinking: {settingLabel(preparation.thinkingLevel)}</div>}
          </>
        ) : (
          <div className="text-sm text-gray-400">Text model: <span className="text-gray-300">Not recorded</span></div>
        )}
      </div>
    </section>
  );
};

export const ImageEditDetails: React.FC<{
  media: GeneratedMedia;
  images: readonly GeneratedMedia[];
  onOpenSource?: (id: string) => void;
}> = ({ media, images, onOpenSource }) => {
  const details = getRecordedImageEditDetails(media, images);
  if (!details) return null;
  const masks = details.layers.filter(layer => layer.tool === 'mask').length;
  const rectangles = details.layers.length - masks;
  const tools = [masks ? `${masks} ${masks === 1 ? 'mask' : 'masks'}` : '', rectangles ? `${rectangles} ${rectangles === 1 ? 'rectangle' : 'rectangles'}` : ''].filter(Boolean).join(' · ');
  return (
    <section aria-label="Image edit details" data-image-edit-details>
      <div className="mb-2 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-violet-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Image edit</h4>
      </div>
      <div className="space-y-3 rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
        <div className="text-xs font-semibold text-gray-300">Edit source</div>
        {details.sourcePreviewUrl ? (
          <div className="relative overflow-hidden rounded-lg border border-gray-700/50 bg-black/30">
            <img src={details.sourcePreviewUrl} alt="Original edit source" className="block h-auto w-full" />
            {details.layers.length > 0 && (
              <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" role="img" aria-label={`Saved edit selection (${details.layers.length} ${details.layers.length === 1 ? 'layer' : 'layers'})`}>
                <title>Saved edit selection</title>
                <g fill="#a3e635" fillOpacity="0.26" stroke="#a3e635" strokeWidth="1.5">
                  {details.layers.map(layer => layer.points ? (
                    <polygon key={layer.id} data-edit-layer-id={layer.id} vectorEffect="non-scaling-stroke" points={layer.points.map(point => `${Number((point.x * 1000).toFixed(3))},${Number((point.y * 1000).toFixed(3))}`).join(' ')} />
                  ) : (
                    <rect key={layer.id} data-edit-layer-id={layer.id} vectorEffect="non-scaling-stroke" x={layer.x * 1000} y={layer.y * 1000} width={layer.width * 1000} height={layer.height * 1000} />
                  ))}
                </g>
              </svg>
            )}
          </div>
        ) : <div className="rounded-lg border border-gray-700/50 bg-black/20 p-4 text-xs text-gray-500">Source preview unavailable</div>}
        <dl className="space-y-2 text-xs">
          <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-gray-500">Source canvas</dt><dd className="text-right text-gray-300">{details.sourceSize ? `${details.sourceSize.width} × ${details.sourceSize.height}` : 'Unavailable'}</dd></div>
          <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-gray-500">Selection</dt><dd className="text-right text-gray-300">{details.layers.length ? `${details.layers.length} ${details.layers.length === 1 ? 'layer' : 'layers'} · ${tools}` : details.sourceReference?.editScope === 'image' ? 'Whole image' : 'Not recorded'}</dd></div>
          {media.imageEditMarkup === true && <div className="flex items-start justify-between gap-3"><dt className="text-gray-500">Provider guidance</dt><dd className="text-right text-gray-300">Marked edit boundary</dd></div>}
          <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-gray-500">Outside selection</dt><dd className={`flex items-center gap-1.5 text-right ${details.preservedOutsideRegion ? 'text-lime-300' : 'text-gray-400'}`}>{details.preservedOutsideRegion && <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}{details.preservedOutsideRegion ? 'Preserved from source' : details.sourceReference?.editScope === 'image' ? 'Not applicable' : 'Not confirmed'}</dd></div>
        </dl>
        {details.layers.length > 0 && <ol aria-label="Saved edit layers" className="flex flex-wrap gap-1.5">{details.layers.map((layer, index) => <li key={layer.id} className="rounded-md border border-gray-700/50 bg-black/20 px-2 py-1 text-[10px] text-gray-400">{index + 1} · {layer.tool === 'mask' ? 'Mask' : 'Rectangle'}</li>)}</ol>}
        {details.source && onOpenSource ? (
          <button type="button" aria-label="View edit source image" onClick={() => onOpenSource(details.source!.id)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400/50"><ArrowLeft className="h-3.5 w-3.5" />View source image</button>
        ) : details.sourceId ? <p className="text-[10px] text-gray-500">Source image is unavailable in this gallery</p> : null}
      </div>
      {details.originalRequest && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Original edit request</h4>
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-gray-700/50 bg-gray-800/50 p-4 text-sm leading-relaxed text-gray-300">{details.originalRequest}</div>
        </div>
      )}
    </section>
  );
};
