/**
 * Street and municipality comparison for a named homeowner reference point.
 * This repo does not merge homeowner docs. The dispo route uses these
 * normalizers when a body homeownerId is within 2000 m of the lead and the
 * street plus municipality match. Punctuation and case are ignored.
 * Suffixes are not expanded: "Street" and "St" stay different.
 */

export function normalizeStreet(value: unknown): string {
  return normalizePlace(value);
}

export function normalizeMunicipality(value: unknown): string {
  return normalizePlace(value);
}

function normalizePlace(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
