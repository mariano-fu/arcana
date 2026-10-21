import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegisterSWOptions } from 'virtual:pwa-register/react';

import { flushAllAutosaves } from '../features/sessions/autosave';
import es from '../i18n/locales/es.json';
import UpdateToast from './UpdateToast';

const U = es.app.update;

const pwa = vi.hoisted(() => ({
  needRefresh: false,
  options: undefined as RegisterSWOptions | undefined,
  updateServiceWorker: vi.fn<(reload?: boolean) => Promise<void>>(),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    pwa.options = options;
    return {
      needRefresh: [pwa.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: pwa.updateServiceWorker,
    };
  },
}));

vi.mock('../features/sessions/autosave', () => ({
  flushAllAutosaves: vi.fn<() => Promise<boolean>>(),
}));
const flushAll = vi.mocked(flushAllAutosaves);

beforeEach(() => {
  pwa.needRefresh = false;
  pwa.options = undefined;
  pwa.updateServiceWorker.mockReset().mockResolvedValue(undefined);
  flushAll.mockReset().mockResolvedValue(true);
});

describe('UpdateToast', () => {
  it('registers the service worker right away and shows nothing while up to date', () => {
    render(<UpdateToast />);
    expect(pwa.options?.immediate).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers to reload when a new version is waiting, and never reloads by itself', async () => {
    vi.useFakeTimers();
    try {
      pwa.needRefresh = true;
      const { rerender } = render(<UpdateToast />);

      expect(screen.getByRole('status')).toHaveTextContent(U.available);
      expect(screen.getByRole('button', { name: U.reload })).toBeEnabled();
      expect(screen.getByRole('button', { name: U.later })).toBeEnabled();

      await act(() => vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      rerender(<UpdateToast />);
      await act(() => vi.advanceTimersByTimeAsync(1000));

      expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
      expect(flushAll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves every autosaved field before reloading into the new version', async () => {
    const order: string[] = [];
    flushAll.mockImplementation(() => {
      order.push('flush');
      return Promise.resolve(true);
    });
    pwa.updateServiceWorker.mockImplementation(() => {
      order.push('update');
      return Promise.resolve();
    });
    pwa.needRefresh = true;
    render(<UpdateToast />);

    await userEvent.click(screen.getByRole('button', { name: U.reload }));

    expect(order).toEqual(['flush', 'update']);
    expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('does not reload when a save fails, and says so', async () => {
    flushAll.mockResolvedValue(false);
    pwa.needRefresh = true;
    render(<UpdateToast />);

    await userEvent.click(screen.getByRole('button', { name: U.reload }));

    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(U.saveFailed);
    expect(screen.getByRole('button', { name: U.reload })).toBeEnabled();
  });

  it('"Ahora no" hides it without reloading', async () => {
    pwa.needRefresh = true;
    render(<UpdateToast />);

    await userEvent.click(screen.getByRole('button', { name: U.later }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
  });
});
