// Seed texts address the consultant as "usted" and must not assume a gender. These words are
// masculine-only when they describe a person; ALLOWED_PHRASES lists uses that don't.
const MASCULINE_WORDS = [
  'sí mismo',
  'seguro',
  'quieto',
  'tranquilo',
  'cansado',
  'agotado',
  'atrapado',
  'bloqueado',
  'estancado',
  'aislado',
  'perdido',
  'herido',
  'heridos',
  'solo',
  'listo',
  'dispuesto',
  'preparado',
  'abierto',
  'cerrado',
  'confiado',
  'curioso',
  'soñador',
  'romántico',
  'observador',
  'estudioso',
  'experto',
  'lleno',
  'otros',
  'todos',
  'un líder',
  'un asesor',
  'el consultante',
];
const ALLOWED_PHRASES = [
  'corazón abierto', // the heart, not the person
  'lugar más tranquilo', // a place
  'solo por lo que', // adverb
];

/** Masculine-only words in `text` that are not covered by the allowlist. */
export function masculineWords(text: string): string[] {
  let rest = text.toLowerCase();
  for (const phrase of ALLOWED_PHRASES) rest = rest.replaceAll(phrase, '');
  return MASCULINE_WORDS.filter((word) =>
    new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'u').test(rest),
  );
}
