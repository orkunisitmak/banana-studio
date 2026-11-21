import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { getImageModelLabel, type GeneratedMedia } from '../types';
import { PROVIDER_LABELS } from '../lib/providers';
import type { BrainstormBatchState } from '../lib/brainstorm/brainstormGeneration';

interface Props {
  state: BrainstormBatchState;
  sample?: GeneratedMedia;
  onViewed: (viewed: boolean) => void;
  onApprove: () => void;
  onStop: () => void;
}

/** The real first output is the review surface; no additional preview is generated. */
export const BrainstormSampleReview: React.FC<Props> = ({ state, sample, onViewed, onApprove, onStop }) => {
  const [loadedSource, setLoadedSource] = useState('');
  const [imageError, setImageError] = useState(false);
  const source = sample && !sample.isLoading && sample.status !== 'failed' ? sample.url : '';
  const loaded = !!source && loadedSource === `${state.id}:${source}`;
  useEffect(() => { setImageError(false); }, [state.id, source]);
  const reviewing = state.phase === 'awaiting_approval';
  return <section aria-label="Brainstorm ilk görsel onayı" className="mb-6 overflow-hidden rounded-2xl border border-amber-400/30 bg-[#121923]">
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-amber-200">{reviewing ? 'İlk görsel hazır. Devam edelim mi?' : 'Önce bir görsel'}</h2>
        <p className="mt-1 text-xs text-gray-400">{getImageModelLabel(state.imageModel)}{state.provider ? ` · ${PROVIDER_LABELS[state.provider]}` : ''}</p>
      </div>
      <button type="button" onClick={onStop} aria-label="Brainstorm denemesini durdur ve kapat" title="Kalan görselleri başlatmadan kapat"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"><X className="h-4 w-4" /></button>
    </div>
    <div className="flex flex-col gap-4 p-4 sm:flex-row">
      <div className="flex min-h-32 items-center justify-center overflow-hidden rounded-xl bg-black/25 sm:w-56 sm:shrink-0">
        {source ? <img key={`${state.id}:${source}`} src={source} alt="Brainstorm partisinin ilk görseli" className="max-h-64 w-full object-contain"
          onLoad={() => { setLoadedSource(`${state.id}:${source}`); setImageError(false); onViewed(true); }}
          onError={() => { setLoadedSource(''); setImageError(true); onViewed(false); }} />
          : <div role="status" className="flex items-center gap-2 px-4 py-6 text-xs text-gray-400"><Loader2 className="h-4 w-4 motion-safe:animate-spin" />{state.phase === 'preparing' ? 'Fikirler hazırlanıyor…' : 'İlk görsel üretiliyor…'}</div>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
        <p role="status" className="text-sm text-gray-200">{reviewing
          ? `Toplam ${state.total} görselden 1 tanesi hazır. Kalan ${state.remaining} görsel henüz başlatılmadı.`
          : `Toplam ${state.total} görselden yalnızca ilk görsel üretilecek. Kalanlar onayını bekleyecek.`}</p>
        {reviewing && <p className="text-xs leading-relaxed text-gray-400">Beğendiysen aynı fikirler ve ayarlarla devam et. İstersen burada durup prompt’u düzenle. İlk görsel galeride kalır.</p>}
        {!reviewing && <p className="text-xs leading-relaxed text-gray-400">Başlatılan ilk görsel tamamlanabilir. Durdurmak, kalan görsellerin gönderilmesini engeller.</p>}
        {imageError && <p role="alert" className="text-xs text-amber-200">İlk görsel açılamadı. Galeriden kontrol et; görüntülenmeden kalan üretim başlatılmaz.</p>}
        <div className="flex flex-wrap gap-2">
          {reviewing && <button type="button" disabled={!loaded || !state.canApprove} onClick={() => { if (loaded && state.canApprove) onApprove(); }}
            className="rounded-xl bg-lime-400 px-4 py-2.5 text-sm font-semibold text-black hover:bg-lime-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500">Kalan {state.remaining} görseli üret</button>}
          <button type="button" onClick={onStop} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">Burada dur</button>
        </div>
        {reviewing && !loaded && !imageError && <p className="text-xs text-gray-500">Görselin görüntülenmesi bekleniyor…</p>}
      </div>
    </div>
  </section>;
};
