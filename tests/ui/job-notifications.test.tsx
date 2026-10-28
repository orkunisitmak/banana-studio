import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestNotificationPermission, useJobNotifications } from '../../src/hooks/useJobNotifications';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn();
  static instances: FakeNotification[] = [];
  constructor(public title: string, public options?: NotificationOptions) {
    FakeNotification.instances.push(this);
  }
}

const installNotification = (permission: NotificationPermission) => {
  FakeNotification.permission = permission;
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockReset();
  FakeNotification.requestPermission.mockResolvedValue(permission);
  vi.stubGlobal('Notification', FakeNotification);
};

describe('job notifications', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not request permission from an effect', () => {
    installNotification('default');
    const { rerender } = renderHook(({ count }) => useJobNotifications(count), {
      initialProps: { count: 0 },
    });
    rerender({ count: 1 });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('sends a neutral notification when the batch finishes', () => {
    installNotification('granted');
    const { rerender } = renderHook(({ count }) => useJobNotifications(count), {
      initialProps: { count: 1 },
    });
    rerender({ count: 0 });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].options?.body).toBe('Your generation batch finished.');
  });

  it('requests permission explicitly and catches a rejected prompt', async () => {
    installNotification('default');
    FakeNotification.requestPermission.mockRejectedValue(new Error('denied'));
    requestNotificationPermission();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
