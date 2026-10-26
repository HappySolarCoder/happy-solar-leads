/**
 * Street and municipality comparison for a named homeowner reference point.
 * This repo does not merge homeowner docs. The dispo route uses these
 * normalizers when a body homeownerId is within 2000 m of the lead and the
 * street plus municipality match. Punctuation and case are ignored.
 * The last street token uses suffix aliases, so "123 Main Street" matches
 * "123 MAIN ST". Municipality names are not rewritten.
 */

const STREET_SUFFIXES: Readonly<Record<string, string>> = {
  street: 'st',
  st: 'st',
  str: 'st',
  avenue: 'ave',
  ave: 'ave',
  av: 'ave',
  road: 'rd',
  rd: 'rd',
  drive: 'dr',
  dr: 'dr',
  boulevard: 'blvd',
  blvd: 'blvd',
  lane: 'ln',
  ln: 'ln',
  court: 'ct',
  ct: 'ct',
  place: 'pl',
  pl: 'pl',
  terrace: 'ter',
  ter: 'ter',
  circle: 'cir',
  cir: 'cir',
  highway: 'hwy',
  hwy: 'hwy',
  parkway: 'pkwy',
  pkwy: 'pkwy',
  trail: 'trl',
  trl: 'trl',
};

export function normalizeStreet(value: unknown): string {
  const place = normalizePlace(value);
  if (!place) return '';
  const parts = place.split(' ');
  const last = parts[parts.length - 1];
  const canonical = STREET_SUFFIXES[last];
  if (canonical) parts[parts.length - 1] = canonical;
  return parts.join(' ');
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
