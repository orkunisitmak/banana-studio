import React from 'react';
import { useTranslation } from '../lib/i18n';

interface YouTubeSafeZoneOverlayProps {
  isVisible: boolean;
}

export function YouTubeSafeZoneOverlay({ isVisible }: YouTubeSafeZoneOverlayProps) {
  const { language } = useTranslation();
  if (!isVisible) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-30 overflow-hidden rounded-[inherit] border-2 border-amber-400/60"
      style={{ boxSizing: 'border-box' }}
    >
      {/* 1/3 Kuralı (Rule of Thirds) Kılavuz Çizgileri */}
      <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
        <div className="border-r border-b border-white/25" />
        <div className="border-r border-b border-white/25" />
        <div className="border-b border-white/25" />
        <div className="border-r border-b border-white/25" />
        <div className="border-r border-b border-white/25" />
        <div className="border-b border-white/25" />
        <div className="border-r border-white/25" />
        <div className="border-r border-white/25" />
        <div />
      </div>

      {/* Sağ Alt Süre Etiketi Kör Noktası (Duration Badge Dead Zone) */}
      <div
        className="absolute bottom-2 right-2 flex items-center justify-center rounded bg-red-600/80 border border-red-400 px-2 py-1 text-[10px] font-bold tracking-wider text-white shadow-lg backdrop-blur-sm animate-pulse"
        style={{ minWidth: '55px', minHeight: '22px' }}
      >
        <span>⚠️ {language === 'tr' ? 'KÖR NOKTA (00:00)' : 'DEAD ZONE (00:00)'}</span>
      </div>

      {/* Üst Güvenli Bölge Rozeti */}
      <div className="absolute top-2 left-2 rounded bg-black/75 border border-amber-400/40 px-2 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-sm">
        {language === 'tr' ? '📐 YouTube Güvenli Alan' : '📐 YouTube Safe Zone'}
      </div>
    </div>
  );
}
