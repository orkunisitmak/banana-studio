import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { addTag, MAX_TAGS, removeTag } from '../../lib/gallery/tags';
import type { GeneratedMedia } from '../../types';

export const TagsEditor = ({
  media,
  readOnly,
  onUpdate,
}: {
  media: GeneratedMedia;
  readOnly?: boolean;
  onUpdate: (tags: string[]) => Promise<void>;
}) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = media.tags || [];

  const save = async (next: string[]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUpdate(next);
      setDraft('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Tags could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Tags</h4>
        <span className="text-[10px] text-gray-600">{tags.length}/{MAX_TAGS}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200"
          >
            {tag}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={busy}
                onClick={() => void save(removeTag(tags, tag))}
                className="text-violet-300/70 transition-colors hover:text-white disabled:opacity-40"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!readOnly && tags.length < MAX_TAGS && (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={event => {
              event.preventDefault();
              const next = addTag(tags, draft);
              if (next.length === tags.length) {
                setDraft('');
                return;
              }
              void save(next);
            }}
          >
            <input
              value={draft}
              onChange={event => setDraft(event.target.value)}
              maxLength={40}
              placeholder="Add tag"
              aria-label="Add tag"
              className="w-24 rounded-md border border-gray-700 bg-gray-800/60 px-2 py-1 text-[11px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/60"
            />
            <button
              type="submit"
              disabled={!draft.trim() || busy}
              aria-label="Save tag"
              className="grid h-6 w-6 place-items-center rounded-md bg-gray-800 text-gray-300 transition-colors hover:bg-violet-600 hover:text-white disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
        {readOnly && !tags.length && <span className="text-[11px] text-gray-600">No tags</span>}
      </div>
      {error && <p role="alert" className="mt-2 text-[11px] text-red-300">{error}</p>}
    </div>
  );
};
