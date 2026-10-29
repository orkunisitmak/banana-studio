import React, { useMemo } from 'react';
import { diffPrompts } from '../lib/prompts/promptDiff';

/** Recomputes the word diff only when either displayed prompt changes, not on every composer render. */
export const PromptDiffText = React.memo(function PromptDiffText({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffPrompts(before, after), [before, after]);
  return <>{parts.map((part, index) => part.type === 'same' ? <span key={index}>{part.text}</span>
    : part.type === 'added' ? <ins key={index} className="rounded-sm bg-emerald-500/15 text-emerald-200 no-underline">{part.text}</ins>
    : <del key={index} className="rounded-sm bg-red-500/10 text-red-300/80">{part.text}</del>)}</>;
});
