import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SUNBURST_MODEL } from '../../lib/images/openaiImage';
import type { GeneratedMedia } from '../../types';

export const RecoverImageButton = ({ media, onRecover }: { media: GeneratedMedia; onRecover?: (image: GeneratedMedia) => Promise<void> }) => {
  const [checking, setChecking] = useState(false);
  if (!onRecover || media.imageModel !== SUNBURST_MODEL) return null;
  return <button disabled={checking} onClick={async event => {
    event.stopPropagation();
    if (checking) return;
    setChecking(true);
    try { await onRecover(media); } finally { setChecking(false); }
  }} className="flex items-center gap-1.5 px-2 py-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-60 rounded text-white text-[10px] font-medium"
    title="Check the saved file and restore it. Does not generate an image or charge for generation.">
    <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />{checking ? 'Checking saved image…' : 'Recover saved image'}
  </button>;
};
