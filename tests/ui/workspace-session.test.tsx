import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '../../src/services/authService';
import { useWorkspaceSession } from '../../src/hooks/useWorkspaceSession';

vi.mock('../../src/services/authService', () => ({
  getSession: vi.fn(),
}));

const getSessionMock = vi.mocked(getSession);

describe('useWorkspaceSession', () => {
  beforeEach(() => getSessionMock.mockReset());

  it('runs an operation between two matching session checks', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } } as never);
    const operation = vi.fn().mockResolvedValue('saved');
    const { result } = renderHook(() => useWorkspaceSession('user-1'));

    await expect(result.current.withWorkspaceSession(operation)('value')).resolves.toBe('saved');
    expect(operation).toHaveBeenCalledWith('value');
    expect(getSessionMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a write when the verified user changes', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-2' } } as never);
    const operation = vi.fn().mockResolvedValue('saved');
    const { result } = renderHook(() => useWorkspaceSession('user-1'));

    await expect(result.current.withWorkspaceSession(operation)()).rejects.toThrow(
      'Session changed. Sign in again to continue.',
    );
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects when the user changes while the operation runs', async () => {
    getSessionMock
      .mockResolvedValueOnce({ user: { id: 'user-1' } } as never)
      .mockResolvedValueOnce({ user: { id: 'user-2' } } as never);
    const operation = vi.fn().mockResolvedValue('saved');
    const { result } = renderHook(() => useWorkspaceSession('user-1'));

    await expect(result.current.withWorkspaceSession(operation)()).rejects.toThrow(
      'Session changed. Sign in again to continue.',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('rejects after the workspace unmounts', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } } as never);
    const { result, unmount } = renderHook(() => useWorkspaceSession('user-1'));
    unmount();
    await expect(result.current.assertWorkspaceSession()).rejects.toThrow('Session changed');
  });
});
