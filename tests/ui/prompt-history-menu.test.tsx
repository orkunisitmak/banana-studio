import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptHistoryMenu } from '../../src/components/PromptHistoryMenu';
import type { PromptHistoryEntry } from '../../src/lib/prompts/promptHistoryStore';

const entries: PromptHistoryEntry[] = [
  { id: 'one', prompt: 'A neon city at night', createdAt: Date.now(), mode: 'image', imageModel: 'gemini-3-pro-image-preview' },
  { id: 'two', prompt: 'A slow dolly through rain', createdAt: Date.now() - 60_000, mode: 'video', videoModel: 'seedance-2.5' },
];

describe('PromptHistoryMenu', () => {
  it('opens the menu and restores an entry', () => {
    const onSelect = vi.fn();
    render(<PromptHistoryMenu entries={entries} onSelect={onSelect} onClear={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Prompt history'));
    fireEvent.click(screen.getByText('A neon city at night'));

    expect(onSelect).toHaveBeenCalledWith(entries[0]);
  });

  it('shows an empty state and clears history', () => {
    const onClear = vi.fn();
    const { rerender } = render(<PromptHistoryMenu entries={[]} onSelect={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByTitle('Prompt history'));
    expect(screen.getByText(/Generate something to build a prompt history/i)).toBeInTheDocument();

    rerender(<PromptHistoryMenu entries={entries} onSelect={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByLabelText('Clear prompt history'));
    expect(onClear).toHaveBeenCalled();
  });
});
