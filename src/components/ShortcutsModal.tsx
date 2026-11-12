import React, { useEffect, useRef } from 'react';
import { X, Command, CornerDownLeft, Sparkles, Folder, Heart, Maximize2, HelpCircle } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const { t, language } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog?.open) {
      dialog.close();
    }
  }, [isOpen]);

  const shortcuts = [
    {
      keys: ['Ctrl / ⌘', 'Enter'],
      description: t('shortcutsModal.generate', 'Generate media'),
      icon: Sparkles,
      color: 'text-violet-400',
    },
    {
      keys: ['Esc'],
      description: t('shortcutsModal.closeModal', 'Close dialog / modal / preview'),
      icon: X,
      color: 'text-rose-400',
    },
    {
      keys: ['?'],
      description: t('shortcutsModal.help', 'Toggle shortcuts cheat sheet'),
      icon: HelpCircle,
      color: 'text-amber-400',
    },
    {
      keys: ['H'],
      description: t('shortcutsModal.history', 'Toggle history panel'),
      icon: Folder,
      color: 'text-sky-400',
    },
    {
      keys: ['F'],
      description: t('shortcutsModal.fullscreen', 'Toggle fullscreen view on preview'),
      icon: Maximize2,
      color: 'text-emerald-400',
    },
  ];

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="shortcuts-modal-title"
      className="max-h-[85vh] w-[calc(100%-3rem)] max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#161b22] p-0 text-white shadow-2xl backdrop:bg-black/75"
    >
      <div className="p-6">
        <div className="mb-5 flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-400">
              <Command size={18} />
            </div>
            <h2 id="shortcuts-modal-title" className="text-base font-semibold text-white">
              {t('shortcutsModal.title', 'Keyboard Shortcuts')}
            </h2>
          </div>
          <button
            autoFocus
            type="button"
            aria-label={t('shortcutsModal.close', 'Close')}
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {shortcuts.map((shortcut, index) => {
            const Icon = shortcut.icon;
            return (
              <div
                key={index}
                className="flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon size={16} className={shortcut.color} />
                  <span className="text-sm text-gray-200">{shortcut.description}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {shortcut.keys.map((k, ki) => (
                    <kbd
                      key={ki}
                      className="inline-flex min-w-[26px] items-center justify-center rounded-md border border-white/15 bg-white/10 px-2 py-1 text-xs font-mono font-medium text-gray-300 shadow-sm"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between rounded-xl bg-violet-500/10 border border-violet-500/20 p-3 text-xs text-violet-300">
          <span>💡 {language === 'tr' ? 'Prompt kutusundayken Ctrl+Enter ile doğrudan üretim başlatabilirsiniz.' : 'You can trigger generation directly with Ctrl+Enter while typing your prompt.'}</span>
        </div>
      </div>
    </dialog>
  );
}
