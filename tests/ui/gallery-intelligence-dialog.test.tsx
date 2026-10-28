import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GalleryIntelligenceDialog } from '../../src/components/GalleryIntelligenceDialog';
import type { GeneratedMedia } from '../../src/types';

const media = (id: string, overrides: Partial<GeneratedMedia> = {}): GeneratedMedia => ({
  id,
  url: `https://example.test/${id}.png`,
  thumbnailUrl: `https://example.test/${id}.png`,
  prompt: 'A hero on a rooftop',
  createdAt: Date.now(),
  aspectRatio: '16:9',
  resolution: '2K',
  imageModel: 'gemini-3-pro-image-preview',
  mediaType: 'image',
  referenceImages: [],
  referenceVideos: [],
  referenceAudios: [],
  ...overrides,
});

describe('GalleryIntelligenceDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows recipe duplicate groups and selects a media item', () => {
    const onSelect = vi.fn();
    render(
      <GalleryIntelligenceDialog
        open
        images={[media('a'), media('b'), media('c', { prompt: 'Other' })]}
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Same recipe')).toBeInTheDocument();
    expect(screen.getByText('1 group')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /A hero on a rooftop/i })[0]);
    expect(onSelect).toHaveBeenCalled();
  });

  it('lists quality issues and switches tabs', () => {
    render(
      <GalleryIntelligenceDialog
        open
        images={[media('bad', { status: 'failed', error: 'Provider rejected it' })]}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Quality/i }));
    expect(screen.getByText('Provider rejected it')).toBeInTheDocument();
  });

  it('opens a print-ready contact sheet and severs the opener', () => {
    const fakeDocument = { write: vi.fn(), close: vi.fn() };
    const fakeWindow = { document: fakeDocument, focus: vi.fn(), print: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);
    render(<GalleryIntelligenceDialog open images={[media('a')]} onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Contact sheet' }));
    fireEvent.click(screen.getByRole('button', { name: /Open contact sheet/i }));

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(fakeDocument.write).toHaveBeenCalledWith(expect.stringContaining('Banana Studio contact sheet'));
    expect(fakeDocument.close).toHaveBeenCalled();
    expect(fakeWindow.focus).toHaveBeenCalled();
    expect(fakeWindow.print).toHaveBeenCalled();
    expect(fakeWindow.opener).toBeNull();
  });

  it('shows a pop-up error when the contact sheet cannot open', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(<GalleryIntelligenceDialog open images={[media('a')]} onClose={vi.fn()} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Contact sheet' }));
    fireEvent.click(screen.getByRole('button', { name: /Open contact sheet/i }));

    expect(screen.getByText('Allow pop-ups to open the contact sheet.')).toBeInTheDocument();
  });
});
