import { db } from '../db';
import { createApi } from './api';
import { createSyncEngine } from './engine';

export { createSyncEngine, type SyncEngine, type SyncReason } from './engine';
export { countPending } from './apply';
export { startSyncTriggers } from './triggers';
export { readStatus, parseStatus, STATUS_KEY, type SyncStatus, type SyncState } from './status';

/** The app's engine, on the app's database and the same-origin API. */
export const syncEngine = createSyncEngine({ db, api: createApi() });
