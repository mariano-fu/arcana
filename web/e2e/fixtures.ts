// Made-up people for the e2e tests. Never real client data (CLAUDE.md).

export const FAKE_CLIENT = {
  name: 'Cliente Prueba E2E',
  instagram: '@prueba.e2e',
  whatsapp: '8888 0000',
  birthDate: '1990-05-15',
  /** Typed into the birth-place field; the suggestion below is picked. */
  cityQuery: 'Escazu',
  city: 'Escazú, San José',
} as const;

export const OTHER_FAKE_CLIENT = { name: 'Persona Ficticia Dos' } as const;

export const OFFLINE_FAKE_CLIENT = { name: 'Cliente Sin Conexión' } as const;

export const SESSION_NOTE = 'Nota de prueba: sin datos reales.';

/**
 * Two-device sync (T3.9). Each run adds a suffix, since a retry syncs with the same server
 * database: the test only looks at its own rows.
 */
export function syncFixtures(run: string) {
  return {
    notesClient: { name: `Ficha Notas ${run}` },
    deletedClient: { name: `Ficha Borrada ${run}` },
    noteA: `Nota del dispositivo A ${run}`,
    noteB: `Nota del dispositivo B ${run}`,
    /** Payment references, so each payment can be found in the list and the CSV. */
    firstPaymentRef: `E2E-P1-${run}`,
    lateralPaymentRef: `E2E-P2-${run}`,
  } as const;
}
