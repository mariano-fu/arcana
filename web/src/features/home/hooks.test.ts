import { act, renderHook } from '@testing-library/react';

import { useTimeZone } from '../../test/time-zone';
import { useToday } from './hooks';

describe('useToday', () => {
  useTimeZone('America/Costa_Rica');

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the local date, not UTC: 23:30 on 31 Oct in Costa Rica is still the 31st', () => {
    vi.setSystemTime(new Date('2026-11-01T05:30:00.000Z'));
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-31');
  });

  it('flips at local midnight while the app stays open, and again a day later', async () => {
    vi.setSystemTime(new Date('2026-11-01T05:59:59.000Z')); // 23:59:59 on 31 Oct, CR
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-31');

    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(result.current).toBe('2026-10-31');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current).toBe('2026-11-01');

    await act(() => vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000));
    expect(result.current).toBe('2026-11-02');
  });

  it('rechecks the date when the app comes back to the foreground', () => {
    vi.setSystemTime(new Date('2026-11-01T05:00:00.000Z'));
    const { result } = renderHook(() => useToday());
    // A suspended app's timers don't run; the clock moves on regardless.
    vi.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-11-02');
  });
});
