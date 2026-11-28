import React, { useEffect, useState } from 'react';
import type { SeedreamResult } from '../lib/images/seedream55';
import { fetchMediaBlob } from '../lib/gallery/mediaDownload';
import { refreshMediaAccessUrl } from '../services/storageService';

/** Other outputs are signed only when viewed or downloaded, never for every gallery tile. */
export function SeedreamResultDetails({ result, onUseAsReference }: { result: SeedreamResult; onUseAsReference?: (url: string) => void }) {
  const [selection, select] = useState(0);
  const [preview, setPreview] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const index = Math.min(selection, result.images.length - 1);
  const image = result.images[index];
  const layer = result.layers?.[index];
  useEffect(() => {
    let active = true;
    setError('');
    refreshMediaAccessUrl(image.url, false).then(url => {
      if (active) setPreview({ source: image.url, url });
    }).catch(() => { if (active) setError('The preview could not be loaded. Try downloading the original.'); });
    return () => { active = false; };
  }, [image.url]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      const blob = await fetchMediaBlob(await refreshMediaAccessUrl(image.url, false));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = image.file_name || `seedream-${index + 1}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Could not download this image. Try again.'); }
    finally { setDownloading(false); }
  };
  return <section aria-label="Seedream outputs" className="space-y-3 rounded-xl border border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-300">
    <h4 className="font-semibold text-white">{result.images.length} {result.layers ? 'layers' : 'generated images'}</h4>
    <label className="block text-xs">{result.layers ? 'Select layer (bottom to top)' : 'Select image'}
      <select className="mt-1 w-full rounded bg-gray-800 p-2 text-white" value={index} onChange={e => select(Number(e.target.value))}>
        {result.images.map((_, i) => <option key={i} value={i}>{result.layers ? `${result.layers[i]?.z_index ?? i}: ${result.layers[i]?.name || (i === 0 ? 'Base image' : 'Layer')}` : `Image ${i + 1}`}</option>)}
      </select>
    </label>
    {preview?.source === image.url && <img className="max-h-72 w-full rounded object-contain" src={preview.url} alt={layer?.name || `Seedream output ${index + 1}`} />}
    {layer?.description && <p>{layer.description}</p>}
    {layer?.bounding_box && <p className="text-xs">Bounds (px): {layer.bounding_box.absolute.join(', ')}<br />Normalized: {layer.bounding_box.normalized.join(', ')}</p>}
    {layer?.text_recognition && <div><strong>Recognized text</strong><p className="whitespace-pre-wrap">{layer.text_recognition.text}</p></div>}
    <details><summary className="cursor-pointer text-xs">{layer ? 'Layer metadata and OCR styles' : 'File metadata'}</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(layer || image, (key, value) => key === 'url' ? undefined : value, 2)}</pre>
    </details>
    <button type="button" className="rounded bg-violet-600 px-3 py-2 text-white disabled:opacity-60" disabled={downloading} onClick={download}>{downloading ? 'Downloading…' : 'Download selected original'}</button>
    {onUseAsReference && <button type="button" className="ml-2 rounded bg-gray-800 px-3 py-2 text-white" onClick={async () => {
      try { onUseAsReference(await refreshMediaAccessUrl(image.url, false)); }
      catch { setError('Could not open this image as a reference. Try again.'); }
    }}>Use as reference</button>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </section>;
}
