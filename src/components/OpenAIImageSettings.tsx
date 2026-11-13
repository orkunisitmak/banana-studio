import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Ratio, Scan, Sparkles } from 'lucide-react';
import type { AspectRatio, GenerationConfig, OpenAIImageOptions, Resolution } from '../types';
import { correctOpenAIImageDimensions, getImageOutputRatio, getOpenAIImageOptions, getOpenAIImageSize, SUNBURST_QUALITY_OPTIONS, validateOpenAIImageSize } from '../lib/images/openaiImage';
import { Dropdown } from './ControlDropdown';
import type { AIProvider } from '../lib/providers';

/** Sunburst controls live alongside the model picker, using the same toolbar UI. */
export const OpenAIImageSettings: React.FC<{
  config: GenerationConfig;
  provider?: AIProvider;
  onChange: (config: GenerationConfig) => void;
  onSizeAdjustment?: (notice: { size: string; text: string } | null) => void;
}> = ({ config, provider, onChange, onSizeAdjustment }) => {
  const options = getOpenAIImageOptions(config.openaiImageOptions);
  const sizeLocked = config.referenceImages.some(ref => ref.isEditSource && ref.editRegion);
  const [draft, setDraft] = useState({ width: String(options.width), height: String(options.height) });
  const dimensionsRef = useRef<HTMLDivElement>(null);
  const commitDimensions = (width: string, height: string) => {
    const corrected = correctOpenAIImageDimensions(Number(width), Number(height), options);
    setDraft({ width: String(corrected.width), height: String(corrected.height) });
    const changed = corrected.width !== Number(width) || corrected.height !== Number(height);
    onSizeAdjustment?.(changed ? { size: `${corrected.width}x${corrected.height}`,
      text: `Auto-adjusted ${width || '—'} × ${height || '—'} → ${corrected.width} × ${corrected.height} px.` } : null);
    if (corrected.width !== options.width || corrected.height !== options.height) update(corrected);
  };
  useEffect(() => {
    setDraft({ width: String(options.width), height: String(options.height) });
    // Old templates can also contain sizes that need correction.
    if (!sizeLocked && options.size === 'custom' && validateOpenAIImageSize(`${options.width}x${options.height}`)) {
      commitDimensions(String(options.width), String(options.height));
    }
  }, [options.size, options.width, options.height, sizeLocked]);
  useEffect(() => {
    // The compact toolbar scrolls horizontally, especially on phones. Reveal
    // the fields after Custom is selected without opening the mobile keyboard.
    if (options.size === 'custom') dimensionsRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [options.size]);
  const update = (patch: Partial<OpenAIImageOptions>, configPatch: Partial<GenerationConfig> = {}) => {
    onChange({ ...config, ...configPatch, openaiImageOptions: getOpenAIImageOptions({ ...options, ...patch }) });
  };
  const selectSize = (value: string) => {
    onSizeAdjustment?.(null);
    if (value === 'custom') {
      // Start from the selected canvas, not the model's unrelated default.
      const [width, height] = getOpenAIImageSize(config).split('x').map(Number);
      update({ size: 'custom', ...(width && height ? { width, height } : {}) });
    } else if (value === 'auto') update({ size: 'auto' });
    else update({ size: 'preset' }, { resolution: value as Resolution });
  };
  const customRatio = getImageOutputRatio(`${options.width}x${options.height}`);
  const sizeError = options.size === 'custom' ? validateOpenAIImageSize(getOpenAIImageSize(config), sizeLocked ? provider : undefined) : null;
  const numberField = (axis: 'width' | 'height') => (
    <label className="flex h-[42px] shrink-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-[#171e28] px-2 text-xs text-gray-500" title={`${axis === 'width' ? 'Width' : 'Height'} (px)`}>
      <span>{axis === 'width' ? 'W' : 'H'}</span>
      <input aria-label={`${axis === 'width' ? 'Width' : 'Height'} (px)`} type="number" inputMode="numeric" min={16} max={3840} step={16} value={draft[axis]}
        onChange={event => {
          setDraft(current => ({ ...current, [axis]: event.target.value }));
          onSizeAdjustment?.(null);
        }}
        onBlur={() => commitDimensions(draft.width, draft.height)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
        }}
        style={{ width: `${Math.max(1, draft[axis].length) + 0.25}ch` }}
        className="min-w-0 max-w-[8ch] bg-transparent text-xs font-semibold tabular-nums text-gray-300 outline-none focus:text-white [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
    </label>
  );
  return <>
    {sizeLocked && <span className="whitespace-nowrap rounded-xl border border-lime-400/20 px-3 py-2 text-xs text-lime-300" title="Protected edits preserve the source canvas">{options.width} × {options.height} source</span>}
    {!sizeLocked && <>
    <Dropdown label="Aspect Ratio" value={options.size === 'preset' ? config.aspectRatio : options.size}
      options={[...(['1:1', '4:3', '3:4', '16:9', '9:16'] as AspectRatio[]).map(value => ({ label: value, value })), { label: 'Custom size', value: 'custom' }, { label: 'Auto size', value: 'auto' }]}
      onSelect={(value: string) => value === 'custom' || value === 'auto' ? selectSize(value) : update({ size: 'preset' }, { aspectRatio: value as AspectRatio })} icon={Ratio} compact />
    {options.size === 'preset' && <Dropdown label="Size" value={config.resolution}
      options={[{ label: 'Auto size', value: 'auto' }, ...(['1K', '2K', '4K'] as Resolution[]).map(value => ({ label: value, value })), { label: 'Custom size', value: 'custom' }]}
      onSelect={selectSize}
      icon={Scan} compact />}
    {options.size === 'custom' && <div ref={dimensionsRef} role="group" aria-label="Custom image dimensions" className="flex shrink-0 items-center gap-1.5">
      {numberField('width')}
      {numberField('height')}
      <button type="button" aria-label="Swap width and height" title="Swap width and height"
        onClick={() => { onSizeAdjustment?.(null); update({ width: options.height, height: options.width }); }}
        className="flex h-[42px] min-w-[42px] shrink-0 items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-[#171e28] px-2.5 text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
        <ArrowLeftRight className="h-3.5 w-3.5" />
        {customRatio && !sizeError && <span className="whitespace-nowrap text-xs font-medium tabular-nums" aria-label={`Custom aspect ratio ${customRatio}`} title={`${options.width} × ${options.height} px`}>{customRatio}</span>}
      </button>
    </div>}
    </>}
    <Dropdown label="Quality" value={options.quality}
      options={SUNBURST_QUALITY_OPTIONS}
      onSelect={(quality: OpenAIImageOptions['quality']) => update({ quality })} icon={Sparkles} compact />
  </>;
};
