import { useState, type Dispatch, type SetStateAction } from 'react';
import { Lock, Shuffle } from 'lucide-react';
import type { GenerationConfig } from '../types';

const MAX_SEED = 2_147_483_647;

export const SeedControl = ({
  config,
  onChange,
}: {
  config: GenerationConfig;
  onChange: Dispatch<SetStateAction<GenerationConfig>>;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const locked = config.seed != null;
  const toggle = () => onChange(current => ({
    ...current,
    seed: current.seed == null ? Math.floor(Math.random() * MAX_SEED) : undefined,
  }));

  return (
    <div className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900/60 px-2">
      <button
        type="button"
        onClick={toggle}
        className={`flex items-center gap-1 text-[11px] font-semibold transition-colors ${locked ? 'text-violet-300' : 'text-gray-400 hover:text-gray-200'}`}
        title={locked ? 'Unlock the seed for random results' : 'Lock a reproducible seed'}
        aria-pressed={locked}
      >
        {locked ? <Lock className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />}
        Seed
      </button>
      <input
        type="number"
        min={0}
        max={MAX_SEED}
        step={1}
        value={draft ?? config.seed ?? ''}
        disabled={!locked}
        placeholder="random"
        aria-label="Seed value"
        onBlur={() => setDraft(null)}
        onChange={event => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() === '') return;
          const value = Number(raw);
          if (!Number.isFinite(value)) return;
          onChange(current => ({
            ...current,
            seed: Math.max(0, Math.min(MAX_SEED, Math.floor(value))),
          }));
        }}
        className="w-20 bg-transparent text-[11px] tabular-nums text-gray-200 outline-none placeholder:text-gray-600 disabled:opacity-50"
      />
    </div>
  );
};
