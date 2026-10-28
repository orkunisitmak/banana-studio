import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TemplateVariablesDialog } from '../../src/components/TemplateVariablesDialog';
import type { Template } from '../../src/types';

const template = {
  id: 'template-1',
  name: 'City portrait',
  createdAt: Date.now(),
  config: {
    prompt: 'A portrait of {{hero}} in {{city}}',
    count: 1,
    aspectRatio: '1:1',
    resolution: '1K',
    imageModel: 'gemini-3-pro-image-preview',
    referenceImages: [],
    referenceVideos: [],
    referenceAudios: [],
    mode: 'image',
    videoModel: 'seedance-2.5',
    videoOperation: 'generate',
    videoAspectRatio: '16:9',
    videoQuality: '720p',
    videoDuration: 5,
    audioEnabled: true,
    videoPromptExpansionMode: 'balanced',
  },
} as Template;

describe('TemplateVariablesDialog', () => {
  it('requires every variable before applying the template', () => {
    const onApply = vi.fn();
    render(<TemplateVariablesDialog template={template} onCancel={vi.fn()} onApply={onApply} />);

    const apply = screen.getByRole('button', { name: /apply template/i });
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByLabelText('hero'), { target: { value: 'Mara' } });
    fireEvent.change(screen.getByLabelText('city'), { target: { value: 'Istanbul' } });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith('A portrait of Mara in Istanbul');
  });

  it('cancels without applying', () => {
    const onCancel = vi.fn();
    const onApply = vi.fn();
    render(<TemplateVariablesDialog template={template} onCancel={onCancel} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
