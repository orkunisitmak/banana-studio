import React from 'react';
import { FileImage, Scan, Sparkles } from 'lucide-react';
import { SEEDREAM_IMAGE_SIZES, SEEDREAM_LAYER_SIZES, SEEDREAM_MAX_IMAGES, SEEDREAM_MAX_INLINE_LAYER_IMAGES, SEEDREAM_MAX_LAYER_IMAGES, type SeedreamOptions } from '../lib/images/seedream55';
import { Dropdown } from './ControlDropdown';

const SIZE_LABELS = {
  square_hd: 'Square HD', square: 'Square', portrait_4_3: 'Portrait 3:4', portrait_16_9: 'Portrait 9:16',
  landscape_4_3: 'Landscape 4:3', landscape_16_9: 'Landscape 16:9', auto_1K: 'Auto 1K', 'auto_1.5K': 'Auto 1.5K', auto_2K: 'Auto 2K', auto: 'Auto (source)',
};
const IMAGE_SIZES = [...SEEDREAM_IMAGE_SIZES.map(value => ({ value, label: SIZE_LABELS[value] })), { value: 'custom', label: 'Custom size' }];
const LAYER_SIZES = SEEDREAM_LAYER_SIZES.map(value => ({ value, label: SIZE_LABELS[value] }));
const BATCH = Array.from({ length: SEEDREAM_MAX_IMAGES }, (_, i) => ({ label: `${i + 1} image${i ? 's' : ''}`, value: String(i + 1) }));
const inputClass = 'flex h-[42px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/[0.07] bg-[#171e28] px-2.5 text-xs text-gray-300';

export function SeedreamSettings({ options, onChange }: { options: SeedreamOptions; onChange: (patch: Partial<SeedreamOptions>) => void }) {
  const layerize = options.mode === 'layerize';
  const custom = typeof options.imageSize === 'object' ? options.imageSize : null;
  const noSync = layerize && options.maxImages > SEEDREAM_MAX_INLINE_LAYER_IMAGES;
  function numberInput(label: string, value: number, max: number, change: (value: number) => void, min = 1) {
    return <label className={inputClass}>{label}
      <input type="number" aria-label={label} inputMode="numeric" min={min} max={max} step={1} value={value || ''}
        className="w-[6ch] rounded bg-black/25 px-1 py-1 tabular-nums text-white" onChange={e => change(Number(e.target.value))} />
    </label>;
  }
  function toggle(label: string, checked: boolean, change: (value: boolean) => void, hint: string, disabled = false) {
    return <label className={`${inputClass} ${disabled ? 'opacity-50' : 'cursor-pointer'}`} title={hint}>
      <input type="checkbox" aria-label={label} aria-description={hint} checked={checked} disabled={disabled}
        className="accent-violet-400" onChange={e => change(e.target.checked)} />{label}
    </label>;
  }
  return <>
    {layerize ? <>
      <Dropdown label="Layer size" value={options.layerSize} options={LAYER_SIZES} onSelect={layerSize => onChange({ layerSize })} icon={Scan} compact />
      {numberInput('Max images (incl. base)', options.maxImages, SEEDREAM_MAX_LAYER_IMAGES, maxImages => onChange({ maxImages }), 2)}
      {toggle('Text recognition', options.enableTextRecognition, enableTextRecognition => onChange({ enableTextRecognition }), 'Include formatted OCR text on recognized text layers.')}
    </> : <>
      <Dropdown label="Image size" value={custom ? 'custom' : String(options.imageSize)} options={IMAGE_SIZES}
        onSelect={size => onChange({ imageSize: size === 'custom' ? { width: 1280, height: 720 } : size })} icon={Scan} compact />
      {custom && <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Custom image dimensions">
        {numberInput('Width (px)', custom.width, 14142, width => onChange({ imageSize: { ...custom, width } }))}
        {numberInput('Height (px)', custom.height, 14142, height => onChange({ imageSize: { ...custom, height } }))}
      </div>}
      <Dropdown label="Images per request" value={String(options.numImages)} options={BATCH} onSelect={n => onChange({ numImages: Number(n) })} icon={Sparkles} compact />
    </>}
    <Dropdown label={layerize ? 'Base image format' : 'Output format'} value={options.outputFormat} options={[
      { value: 'png', label: layerize ? 'PNG base' : 'PNG' }, { value: 'jpeg', label: layerize ? 'JPEG base' : 'JPEG', disabled: !layerize && options.background === 'transparent' },
    ]} onSelect={outputFormat => onChange({ outputFormat })} icon={FileImage} compact />
    {!layerize && <Dropdown label="Background" value={options.background} options={[
      { value: 'auto', label: 'Auto background' }, { value: 'opaque', label: 'Opaque' },
      { value: 'transparent', label: 'Transparent (PNG)', disabled: options.outputFormat !== 'png' },
    ]} onSelect={background => onChange({ background })} compact />}
    {toggle('Watermark', options.watermark, watermark => onChange({ watermark }), 'Include the visible provider watermark.')}
    {toggle('Sync mode', !noSync && options.syncMode, syncMode => onChange({ syncMode }), noSync
      ? `Above ${SEEDREAM_MAX_INLINE_LAYER_IMAGES} outputs, fal always returns URLs.` : 'Request inline data instead of URLs. Output data is not available in fal request history.', noSync)}
    {toggle('Safety checker', options.enableSafetyChecker, enableSafetyChecker => onChange({ enableSafetyChecker }), 'Disabling checks requires fal account authorization.')}
  </>;
}
