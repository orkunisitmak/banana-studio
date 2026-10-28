import React from 'react';
import { Clock, RotateCcw, X, Image as ImageIcon, Layers } from 'lucide-react';
import { GeneratedImage } from '../types';
import { getImageOutputRatio, getImageResolutionLabel } from '../lib/images/openaiImage';

interface HistoryPanelProps {
  images: GeneratedImage[];
  onSelect: (image: GeneratedImage) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  images,
  onSelect,
  isOpen,
  onClose,
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="w-80 h-full bg-gray-900 border-l border-gray-800 flex flex-col shrink-0 animate-in slide-in-from-right duration-200 shadow-xl z-20">
      <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-white">
          <Clock className="w-5 h-5 text-violet-400" />
          <h2 className="font-semibold">History</h2>
        </div>
        <button 
          onClick={onClose}
          className="p-1 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {images.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            <p>No history yet.</p>
            <p className="mt-1">Generated images will appear here.</p>
          </div>
        ) : (
          images.map((img) => (
            <div 
              key={img.id}
              className="bg-gray-800/40 rounded-xl p-3 border border-gray-700/50 hover:border-violet-500/30 hover:bg-gray-800 transition-all group"
            >
              <div className="flex gap-3 mb-3">
                <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-gray-900 border border-gray-700 relative">
                  <img 
                    src={img.thumbnailUrl || img.url} 
                    alt="Thumbnail" 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400 line-clamp-2 mb-1">
                    {img.prompt}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono bg-gray-900 text-gray-500 px-1.5 py-0.5 rounded border border-gray-700">
                      {getImageResolutionLabel(img)}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-900 text-gray-500 px-1.5 py-0.5 rounded border border-gray-700">
                      {getImageOutputRatio(img.imageOutputSize || img.imageRequestedSize) || img.aspectRatio}
                    </span>
                    {img.referenceImages && img.referenceImages.length > 0 && (
                       <span className="text-[10px] font-mono bg-violet-900/30 text-violet-400 px-1.5 py-0.5 rounded border border-violet-500/20 flex items-center gap-1">
                         {img.referenceImages.length > 1 ? <Layers className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
                         {img.referenceImages.length}
                       </span>
                    )}
                  </div>
                </div>
              </div>
              
              <button
                onClick={() => onSelect(img)}
                className="w-full py-1.5 flex items-center justify-center gap-2 bg-gray-700 hover:bg-violet-600 text-xs font-medium text-white rounded-lg transition-colors opacity-0 group-hover:opacity-100"
              >
                <RotateCcw className="w-3 h-3" /> Use Settings
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
