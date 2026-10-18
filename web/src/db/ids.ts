import { v7 as uuidv7 } from 'uuid';

import type { IsoDateTime } from './types';

/** Time-ordered UUIDv7, so devices can create rows offline without collisions. */
export function newId(): string {
  return uuidv7();
}

export function nowIso(): IsoDateTime {
  return new Date().toISOString();
}
