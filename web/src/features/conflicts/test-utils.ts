import type { Conflict, SyncedTableName } from '../../db';

/** The server's nil device: conflict rows are created by the server. */
export const SERVER_DEVICE = '00000000-0000-0000-0000-000000000000';

/** A conflict row as the server creates it and sync stores it (fake text only). */
export function conflictRow(
  table: SyncedTableName,
  recordId: string,
  field: string,
  overrides: Partial<Conflict> = {},
): Conflict {
  return {
    id: crypto.randomUUID(),
    table,
    record_id: recordId,
    field,
    losing_value: 'Texto del otro dispositivo',
    losing_device_id: 'other-device',
    created_at: '2026-10-20T12:00:00.000Z',
    resolved: false,
    updated_at: '2026-10-20T12:00:00.000Z',
    deleted_at: null,
    server_version: 7,
    device_id: SERVER_DEVICE,
    pending: 0,
    ...overrides,
  };
}
