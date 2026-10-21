// Persistent storage (constitution: request it, and remind her to back up when it's denied).
// The browser decides: Safari and Chrome answer without asking her; only Firefox shows a prompt.

export type PersistenceStatus = 'persisted' | 'not_persisted' | 'unsupported';

/** The parts of `navigator.storage` used here; any of them may be missing. */
export interface StorageApi {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** `navigator.storage`, or undefined where the browser has none (or outside a secure context). */
export function browserStorage(): StorageApi | undefined {
  return (navigator as { storage?: StorageApi }).storage;
}

export async function persistenceStatus(
  storage: StorageApi | undefined = browserStorage(),
): Promise<PersistenceStatus> {
  if (!storage?.persisted || !storage.persist) return 'unsupported';
  return (await storage.persisted()) ? 'persisted' : 'not_persisted';
}

/** Asks for persistent storage unless it's already granted; returns the resulting status. */
export async function requestPersistence(
  storage: StorageApi | undefined = browserStorage(),
): Promise<PersistenceStatus> {
  const current = await persistenceStatus(storage);
  if (current !== 'not_persisted' || !storage?.persist) return current;
  return (await storage.persist()) ? 'persisted' : 'not_persisted';
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

/** Roughly how much space the app uses and may use; null when the browser can't tell. */
export async function storageEstimate(
  storage: StorageApi | undefined = browserStorage(),
): Promise<StorageEstimate | null> {
  if (!storage?.estimate) return null;
  try {
    const { usage, quota } = await storage.estimate();
    return usage === undefined || quota === undefined ? null : { usage, quota };
  } catch {
    return null;
  }
}

const unitFormat = (unit: string, digits: number) =>
  new Intl.NumberFormat('es-CR', {
    style: 'unit',
    unit,
    maximumFractionDigits: digits,
  });

/**
 * Bytes in decimal units like the iPhone's own storage screen: `850 kB`, `12 MB`, `3,4 MB`,
 * `1,9 GB`. One decimal below 10, none above.
 */
export function formatBytes(bytes: number): string {
  // A value that would round up to 1000 of a unit is shown in the next one ("1 MB", not "1000 kB").
  const units = [
    ['gigabyte', 1e9],
    ['megabyte', 1e6],
  ] as const;
  for (const [unit, size] of units) {
    if (bytes >= size * 0.9995) {
      const value = bytes / size;
      return unitFormat(unit, value < 10 ? 1 : 0).format(value);
    }
  }
  return unitFormat('kilobyte', 0).format(Math.max(bytes / 1e3, bytes > 0 ? 1 : 0));
}
