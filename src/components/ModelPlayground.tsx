import { useEffect, useRef, useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { buildModelComparison } from '../lib/images/modelComparison';
import {
  IMAGE_MODEL_OPTIONS,
  type AspectRatio,
  type GeneratedMedia,
  type GenerationConfig,
  type ImageModelId,
  type Resolution,
} from '../types';

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const RESOLUTIONS: Resolution[] = ['1K', '2K', '4K'];

const getAlternateModel = (model: ImageModelId): ImageModelId =>
  IMAGE_MODEL_OPTIONS.find(option => option.value !== model)?.value || model;

export const ModelPlayground = ({
  open,
  config,
  images,
  onClose,
  onApply,
}: {
  open: boolean;
  config: GenerationConfig;
  images: GeneratedMedia[];
  onClose: () => void;
  onApply: (patch: Partial<GenerationConfig>) => void;
}) => {
  const [prompt, setPrompt] = useState(config.prompt);
  const [modelA, setModelA] = useState<ImageModelId>(config.imageModel);
  const [modelB, setModelB] = useState<ImageModelId>(() => getAlternateModel(config.imageModel));
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(config.aspectRatio);
  const [resolution, setResolution] = useState<Resolution>(config.resolution);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt(config.prompt);
    setModelA(config.imageModel);
    setModelB(getAlternateModel(config.imageModel));
    setAspectRatio(config.aspectRatio);
    setResolution(config.resolution);
  }, [open, config.imageModel, config.prompt, config.aspectRatio, config.resolution]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      if (dialog?.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
    };
  }, [open]);

  if (!open) return null;

  const comparisons = [modelA, modelB].map(model =>
    buildModelComparison(model, { aspectRatio, resolution, images }),
  );
  const canApply = prompt.trim().length > 0;

  return (
    <dialog
      ref={dialogRef}
      onCancel={event => { event.preventDefault(); onClose(); }}
      aria-labelledby="model-playground-title"
      className="fixed inset-0 z-[90] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/75 p-4 backdrop:bg-black/75"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-700 bg-[#161b22] p-6 text-white shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="model-playground-title" className="flex items-center gap-2 text-lg font-semibold">
              <FlaskConical className="h-5 w-5 text-violet-400" />
              Model playground
            </h2>
            <p className="mt-1 text-xs text-gray-500">Compare model, estimated cost and past latency before generating. This does not spend credits.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close model playground" className="text-gray-500 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">Prompt</span>
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            rows={3}
            placeholder="Describe the image you want to compare"
            className="w-full resize-y rounded-xl border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-violet-500/60"
          />
        </label>

        <div className="mb-4 flex flex-wrap gap-3">
          <label className="text-[11px] font-medium text-gray-500">
            Ratio
            <select value={aspectRatio} onChange={event => setAspectRatio(event.target.value as AspectRatio)} className="ml-2 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200">
              {ASPECT_RATIOS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium text-gray-500">
            Resolution
            <select value={resolution} onChange={event => setResolution(event.target.value as Resolution)} className="ml-2 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200">
              {RESOLUTIONS.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {comparisons.map((comparison, index) => (
            <section key={index} className="rounded-xl border border-gray-700/70 bg-gray-900/40 p-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">Model {index === 0 ? 'A' : 'B'}</span>
                <select
                  value={comparison.model}
                  onChange={event => {
                    const nextModel = event.target.value as ImageModelId;
                    if (index === 0) {
                      setModelA(nextModel);
                      if (nextModel === modelB) setModelB(getAlternateModel(nextModel));
                    } else {
                      setModelB(nextModel);
                      if (nextModel === modelA) setModelA(getAlternateModel(nextModel));
                    }
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-sm text-gray-100"
                >
                  {IMAGE_MODEL_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>

              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Provider</dt>
                  <dd className="text-right text-gray-300">{comparison.provider}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Estimated cost</dt>
                  <dd className="text-right font-medium text-violet-200">{comparison.costLabel}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Average latency</dt>
                  <dd className="text-right text-gray-300">
                    {comparison.averageSeconds == null ? 'No samples yet' : `~${comparison.averageSeconds}s`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-gray-500">Samples</dt>
                  <dd className="text-right text-gray-300">{comparison.samples}</dd>
                </div>
              </dl>

              <button
                type="button"
                disabled={!canApply}
                onClick={() => onApply({ mode: 'image', imageModel: comparison.model, prompt, aspectRatio, resolution })}
                className="mt-4 w-full rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Use {comparison.label} in composer
              </button>
            </section>
          ))}
        </div>

        <p className="mt-4 text-[10px] leading-5 text-gray-600">
          Costs are estimates based on the selected ratio and resolution. Nano Banana and GPT Image with references can bill additional input tokens. Latency comes from your own completed generations.
        </p>
      </div>
    </dialog>
  );
};
