import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Trash2 } from 'lucide-react';
import type { PromptHistoryEntry } from '../lib/prompts/promptHistoryStore';

const ageLabel = (createdAt: number): string => {
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const PromptHistoryMenu = ({
  entries,
  onSelect,
  onClear,
}: {
  entries: PromptHistoryEntry[];
  onSelect: (entry: PromptHistoryEntry) => void;
  onClear: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (buttonRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
    }
    setOpen(current => !current);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Prompt history"
        aria-expanded={open}
        className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition-all ${
          open ? 'border-violet-400/35 bg-violet-500/15 text-violet-200' : 'border-white/[0.07] bg-[#171e28] text-gray-400 hover:border-white/15 hover:bg-[#1b2330] hover:text-white'
        }`}
      >
        <Clock className="h-5 w-5" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: position.left, bottom: position.bottom, zIndex: 9999 }}
          className="w-[320px] overflow-hidden rounded-2xl border border-gray-700/50 bg-[#161b22] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Clock className="h-4 w-4 text-violet-400" />
              Prompt history
            </h3>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={() => { onClear(); setOpen(false); }}
                aria-label="Clear prompt history"
                className="text-gray-500 transition-colors hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto p-2">
            {entries.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-gray-500">Generate something to build a prompt history.</p>
            ) : entries.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => { onSelect(entry); setOpen(false); }}
                className="block w-full rounded-xl p-3 text-left transition-colors hover:bg-gray-800/60"
              >
                <span className="line-clamp-2 text-xs leading-5 text-gray-200">{entry.prompt}</span>
                <span className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
                  <span>{entry.mode}</span>
                  <span>·</span>
                  <span>{ageLabel(entry.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
