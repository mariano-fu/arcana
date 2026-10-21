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
