import React, { useState } from 'react';
import { Sparkles, Youtube, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

export interface ThumbnailPreset {
  id: string;
  nameTr: string;
  nameEn: string;
  descriptionTr: string;
  descriptionEn: string;
  prompt: string;
}

export const THUMBNAIL_PRESETS: ThumbnailPreset[] = [
  {
    id: 'reaction',
    nameTr: '😲 Şaşırma & Yüksek CTR',
    nameEn: '😲 High CTR Reaction',
    descriptionTr: 'Abartılı yüz ifadesi, parlak gözler, dramatik stüdyo ışığı',
    descriptionEn: 'Exaggerated facial expression, wide eyes, bold rim lighting',
    prompt: 'YouTube thumbnail style, ultra-expressive shocked reaction face, wide eyes, open mouth excitement, dramatic studio rim lighting, vibrant neon background glow, clean sharp edges, hyper-detailed, 8k resolution, cinematic color grading',
  },
  {
    id: 'versus',
    nameTr: '⚔️ Versus / Karşılaşma (1v1)',
    nameEn: '⚔️ Versus / Comparison',
    descriptionTr: 'İkiye bölünmüş ekran, sol soğuk mavi sağ alevli kırmızı',
    descriptionEn: 'Split screen, left cold blue tone vs right fiery red tone',
    prompt: 'YouTube thumbnail split screen versus composition, left side cold icy blue lightning aura, right side intense fiery explosion embers, high contrast, dramatic central divide, epic movie poster aesthetic, sharp focus, 8k',
  },
  {
    id: 'mystery',
    nameTr: '🎁 Gizemli Öğe / MrBeast Tarzı',
    nameEn: '🎁 Mystery Challenge',
    descriptionTr: 'Altın ışıltılı dev gizemli kutu, merak uyandıran atmosfer',
    descriptionEn: 'Glowing giant mystery box, saturated colors, curiosity-inducing',
    prompt: 'High saturation YouTube thumbnail, giant glowing gold mystery container with question marks, intense volumetric rays bursting out, dynamic wide-angle lens, hyper-realistic, vibrant saturation, high click-through rate design',
  },
  {
    id: 'cinematic',
    nameTr: '🎬 Sinematik Belgesel / Vlog',
    nameEn: '🎬 Cinematic Documentary',
    descriptionTr: 'Dramatik derinlik, 85mm lens, atmosferik sis ve gölgeler',
    descriptionEn: 'Dramatic depth of field, 85mm lens, atmospheric haze',
    prompt: 'Cinematic YouTube documentary thumbnail, moody atmospheric lighting, dramatic portrait with shallow depth of field, anamorphic lens flare, gritty realistic texture, dark aesthetic with striking focal highlight',
  },
  {
    id: 'tech_review',
    nameTr: '📱 Teknoloji / Ürün İnceleme',
    nameEn: '📱 Tech / Product Showcase',
    descriptionTr: 'Minimal fütüristik arka plan, parıldayan ürün detayı',
    descriptionEn: 'Clean studio gradient, floating sleek gadget with reflections',
    prompt: 'High-end tech review YouTube thumbnail, floating sleek futuristic gadget, soft studio bounce lighting, subtle cyan and purple gradient background, crisp specular highlights, minimal clean aesthetic, 8k product render',
  },
];

interface YouTubeThumbnailPresetsProps {
  onSelectPreset: (promptText: string) => void;
}

export function YouTubeThumbnailPresets({ onSelectPreset }: YouTubeThumbnailPresetsProps) {
  const { language } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (preset: ThumbnailPreset) => {
    setSelectedId(preset.id);
    onSelectPreset(preset.prompt);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 hover:border-red-400/50 transition-all shadow-sm"
        title={language === 'tr' ? 'Hazır YouTube Thumbnail Şablonları' : 'YouTube Thumbnail Quick Presets'}
      >
        <Youtube size={14} className="text-red-400 fill-red-400" />
        <span>{language === 'tr' ? 'YouTube Kapak Şablonları' : 'YT Thumbnail Presets'}</span>
        <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute left-0 bottom-full mb-2 z-50 w-72 origin-bottom-left rounded-2xl border border-white/10 bg-[#161b22] p-2 text-white shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-white/[0.06] mb-1 flex items-center justify-between">
              <span>{language === 'tr' ? 'Yüksek Tıklanma (CTR) Şablonları' : 'High CTR Presets'}</span>
              <Sparkles size={12} className="text-amber-400" />
            </div>

            <div className="space-y-1">
              {THUMBNAIL_PRESETS.map((preset) => {
                const isSelected = selectedId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelect(preset)}
                    className={`w-full text-left rounded-xl p-2 transition-all flex items-start justify-between gap-2 ${
                      isSelected
                        ? 'bg-red-500/15 border border-red-500/30 text-white'
                        : 'hover:bg-white/[0.06] text-gray-200'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-medium">
                        {language === 'tr' ? preset.nameTr : preset.nameEn}
                      </div>
                      <div className="text-[10px] text-gray-400 line-clamp-1 mt-0.5">
                        {language === 'tr' ? preset.descriptionTr : preset.descriptionEn}
                      </div>
                    </div>
                    {isSelected && <Check size={14} className="text-red-400 shrink-0 mt-0.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
