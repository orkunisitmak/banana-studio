import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyBoundary } from '../../src/components/LazyBoundary';

const Exploding = () => {
  throw new Error('chunk failed');
};

describe('LazyBoundary', () => {
  it('keeps the studio mounted and offers a reload action', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <LazyBoundary label="Admin panel">
        <Exploding />
      </LazyBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Admin panel could not load');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('can be dismissed without reloading the whole studio', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <LazyBoundary label="Admin panel">
        <Exploding />
      </LazyBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(container).toBeEmptyDOMElement();
    consoleError.mockRestore();
  });
});
