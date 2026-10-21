import { formatBytes, persistenceStatus, requestPersistence, storageEstimate } from './storage';

const api = (persisted: boolean, grant = persisted) => ({
  persisted: vi.fn(() => Promise.resolve(persisted)),
  persist: vi.fn(() => Promise.resolve(grant)),
});

describe('persistence', () => {
  it('reports unsupported when the browser has no storage API', async () => {
    expect(await persistenceStatus(undefined)).toBe('unsupported');
    expect(await persistenceStatus({ persisted: () => Promise.resolve(true) })).toBe('unsupported');
    expect(await requestPersistence(undefined)).toBe('unsupported');
  });

  it('asks only when not yet persistent', async () => {
    const granted = api(true);
    expect(await requestPersistence(granted)).toBe('persisted');
    expect(granted.persist).not.toHaveBeenCalled();

    const later = api(false, true);
    expect(await requestPersistence(later)).toBe('persisted');
    expect(later.persist).toHaveBeenCalledOnce();

    const denied = api(false, false);
    expect(await requestPersistence(denied)).toBe('not_persisted');
  });
});

describe('storageEstimate', () => {
  it('returns usage and quota, or null when the browser cannot tell', async () => {
    const estimate = (value: object) => ({ estimate: () => Promise.resolve(value) });
    expect(await storageEstimate(estimate({ usage: 10, quota: 100 }))).toEqual({
      usage: 10,
      quota: 100,
    });
    expect(await storageEstimate(estimate({ usage: 10 }))).toBeNull();
    expect(await storageEstimate({})).toBeNull();
    expect(await storageEstimate({ estimate: () => Promise.reject(new Error('no')) })).toBeNull();
  });
});

describe('formatBytes', () => {
  // es-CR separates with a comma and a no-break space before the unit.
  const fold = (text: string) => text.replace(/\s/g, ' ');

  it('uses decimal units with one decimal below 10', () => {
    expect(fold(formatBytes(0))).toBe('0 kB');
    expect(fold(formatBytes(1))).toBe('1 kB');
    expect(fold(formatBytes(850_000))).toBe('850 kB');
    expect(fold(formatBytes(999_999))).toBe('1 MB');
    expect(fold(formatBytes(999_600_000))).toBe('1 GB');
    expect(fold(formatBytes(1_000_000))).toBe('1 MB');
    expect(fold(formatBytes(3_450_000))).toBe('3,5 MB');
    expect(fold(formatBytes(12_400_000))).toBe('12 MB');
    expect(fold(formatBytes(1_940_000_000))).toBe('1,9 GB');
    expect(fold(formatBytes(64_000_000_000))).toBe('64 GB');
  });
});
