import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrandKitDialog } from '../../src/components/BrandKitDialog';
import { DEFAULT_BRAND_KIT } from '../../src/lib/brand/kit';

describe('BrandKitDialog', () => {
  it('edits and saves the brand name and accent color', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<BrandKitDialog kit={DEFAULT_BRAND_KIT} onClose={onClose} onSave={onSave} />);

    fireEvent.change(screen.getByDisplayValue(DEFAULT_BRAND_KIT.name), { target: { value: 'Acme Studio' } });
    fireEvent.change(screen.getByLabelText('Accent color'), { target: { value: '#ff5500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save brand kit' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Acme Studio',
      accentColor: '#ff5500',
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it('resets the draft without saving', () => {
    const onSave = vi.fn();
    render(<BrandKitDialog kit={{ ...DEFAULT_BRAND_KIT, name: 'Custom' }} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(screen.getByDisplayValue(DEFAULT_BRAND_KIT.name)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
