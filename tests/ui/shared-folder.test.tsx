import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedFolder } from '../../src/components/SharedFolder';

const token = 'a'.repeat(43);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('SharedFolder', () => {
  beforeEach(() => {
    window.location.hash = token;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('renders the shared folder with Banana Studio branding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          name: 'Launch stills',
          images: [{ id: 'media-1', url: 'https://example.test/one.png' }],
          nextOffset: null,
        }),
      ),
    );

    render(<SharedFolder />);

    expect(await screen.findByText('Launch stills')).toBeInTheDocument();
    expect(screen.getByText('BANANA STUDIO')).toBeInTheDocument();
    expect(screen.getByAltText('Shared image 1')).toHaveAttribute(
      'src',
      'https://example.test/one.png',
    );
  });

  it('surfaces the server error for expired links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'This share link is unavailable or expired.' }, 404),
      ),
    );

    render(<SharedFolder />);

    expect(
      await screen.findByText('This share link is unavailable or expired.'),
    ).toBeInTheDocument();
  });

  it('rejects malformed tokens before any request', async () => {
    window.location.hash = 'short';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<SharedFolder />);

    expect(
      await screen.findByText('This share link is unavailable or expired.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
