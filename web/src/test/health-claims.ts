// Seed texts describe associations and traditional uses, never health or medical claims
// (constitution §5). These patterns match whole words that claim or imply a cure or treatment.
// Some also catch harmless uses ("se trata de", "una relación sana"); rephrase those.
const HEALTH_CLAIM_PATTERNS = [
  'cura',
  'curas',
  'curar',
  'curaci[oó]n',
  'curativ[oa]s?',
  'sana',
  'sanar',
  'sanaci[oó]n',
  'sanador(a|es|as)?',
  'trata',
  'tratar',
  'tratamientos?',
  'alivia',
  'aliviar',
  'alivios?',
  'enfermedad(es)?',
  'medicina(s|l|les)?',
  's[ií]ntomas?',
  'dolor(es)?',
  'terapias?',
  'terap[eé]utic[oa]s?',
  'diagn[oó]stic[oa]s?',
];

/** Health-claim words found in `text`, as written there (lowercased). */
export function healthClaims(text: string): string[] {
  const lower = text.toLowerCase();
  return HEALTH_CLAIM_PATTERNS.flatMap(
    (pattern) => lower.match(new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, 'gu')) ?? [],
  );
}
