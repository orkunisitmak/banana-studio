import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagsEditor } from '../../src/components/gallery/TagsEditor';
import type { GeneratedMedia } from '../../src/types';

const media = {
  id: 'media-1',
  url: 'https://example.test/one.png',
  prompt: 'A hero',
  createdAt: Date.now(),
  aspectRatio: '1:1',
  resolution: '1K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  tags: ['night'],
} as GeneratedMedia;

describe('TagsEditor', () => {
  it('shows a visible error when saving fails', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('Tags could not be saved.'));
    render(<TagsEditor media={media} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByLabelText('Remove tag night'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tags could not be saved.');
    expect(screen.getByText('night')).toBeInTheDocument();
  });

  it('adds a tag and clears the draft on success', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<TagsEditor media={media} onUpdate={onUpdate} />);

    fireEvent.change(screen.getByLabelText('Add tag'), { target: { value: 'neon' } });
    fireEvent.click(screen.getByLabelText('Save tag'));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(['night', 'neon']));
    expect(screen.getByLabelText('Add tag')).toHaveValue('');
  });
});
