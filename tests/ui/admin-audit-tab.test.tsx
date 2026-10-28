import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuditTab } from '../../src/components/AdminAuditTab';

vi.mock('../../src/services/auditService', () => ({
  fetchAuditEvents: vi.fn().mockResolvedValue([
    {
      id: 'event-1',
      user_id: 'user-1',
      action: 'generation.accepted',
      target_type: 'generation',
      target_id: 'gen-1',
      metadata: { model: 'gemini-3-pro-image-preview' },
      created_at: '2026-10-28T08:00:00Z',
    },
  ]),
}));

describe('AdminAuditTab', () => {
  it('renders audit events with action and target', async () => {
    render(<AdminAuditTab />);
    await waitFor(() => expect(screen.getByText('generation.accepted')).toBeInTheDocument());
    expect(screen.getByText(/generation · gen-1/)).toBeInTheDocument();
    expect(screen.getByText(/gemini-3-pro-image-preview/)).toBeInTheDocument();
  });
});
