// Empower bump: request contract, band math, labels, and the GHL note text.
// Pure functions only. No I/O here so the contract is easy to test.

import { EMPOWER_INCOME_LIMITS } from './empowerIncomeLimits';

export const EMPOWER_GHL_LOCATION_ID = 'MMKRDviKggXzlcHQTnvZ';
export const EMPOWER_PIPELINE_ID = '5hPKCGzAskcC6LEZuc1H';
/** Empower+ stage "Portal Creation Needed". */
export const EMPOWER_CREATE_STAGE_ID = '81524518-3f46-4944-91e1-bfea838ec3a0';

/** Live GHL custom field ids (GHL-STORAGE-PROPOSAL.md, re-read Nov 23 2026). Ids are not secrets. */
export const GHL_FIELDS = {
  contactHouseholdSize: 'xsujuDj122LgY2y8mQNw',
  contactAnnualHouseholdIncome: '96dkrAZCmhl7Bce9V8jr',
  contactEmpower: 'btVDhuTeuuikdjnGwnty',
  contactEmpowerStatus: 'yaVrihjxyQcymTxC9GNS',
  contactEmpowerTier: 'qB7rjZU70B1K4f1uvUOz',
  opportunityEmpower: '2RWH7mHStfeZG6Um6Po5',
  opportunityEmpowerTier: 'iAnc1oufbV4g8NEIZfDu',
  opportunityNotes: 'cCcnzoIp8YgW2Pr0sB5E',
} as const;

/** Empower Status options in pipeline order. A bump never moves a contact backward. */
export const EMPOWER_STATUS_ORDER = [
  'Portal Creation Needed',
  'Portal Created',
  'Income Documents Obtained',
] as const;
export const EMPOWER_STATUS_ON_CREATE = EMPOWER_STATUS_ORDER[0];

/** Exact Manual §2.5.2 labels, in UI order (ASSISTANCE-PROGRAMS.md). */
export const ASSISTANCE_PROGRAMS = [
  'HEAP (Home Energy Assistance Program)',
  'SNAP (Supplemental Nutrition Assistance Program/Food Stamps)/SNAP NYC',
  'SSI (Supplemental Security Income)',
  'TANF (Temporary Assistance for Needy Families)',
  'Weatherization Assistance Program',
  'Public Assistance',
] as const;
const ASSISTANCE_SET = new Set<string>(ASSISTANCE_PROGRAMS);

export type EstimatedBand = 'tier1' | 'tier3' | 'comfort_home' | 'not_sure';
const BANDS = new Set<EstimatedBand>(['tier1', 'tier3', 'comfort_home', 'not_sure']);

export const ESTIMATED_BAND_LABELS: Record<EstimatedBand, string> = {
  tier1: 'Tier 1 (est.)',
  tier3: 'Tier 3 (est.)',
  comfort_home: 'Comfort Home (est.)',
  not_sure: 'Not sure',
};

const ALLOWED_KEYS = new Set([
  'draftId',
  'actedAt',
  'leadId',
  'name',
  'phone',
  'email',
  'address',
  'city',
  'state',
  'zip',
  'town',
  'county',
  'householdSize',
  'estimatedBand',
  'assistancePrograms',
  'assistanceNone',
  'annualHouseholdIncome',
  'repName',
]);

const COUNTY_BY_LOWER = new Map(Object.keys(EMPOWER_INCOME_LIMITS).map((name) => [name.toLowerCase(), name]));

export const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
export const MAX_ANNUAL_INCOME = 10_000_000;

export type EmpowerBumpRequest = {
  draftId: string;
  actedAt: string;
  leadId: string;
  name: string;
  phone: string;
  /** Last 10 digits, used for the GHL lookup and E.164 phone. */
  phoneLast10: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  town?: string;
  county?: string;
  householdSize: number;
  estimatedBand?: EstimatedBand;
  assistancePrograms: string[];
  assistanceNone: boolean;
  annualHouseholdIncome?: number;
  repName?: string;
};

export type ParseResult = { ok: true; value: EmpowerBumpRequest } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function requiredLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = cleanLine(value);
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/** undefined = absent/empty, null = invalid. */
function optionalLine(value: unknown, max: number): string | undefined | null {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = cleanLine(value);
  if (!trimmed) return undefined;
  if (trimmed.length > max) return null;
  return trimmed;
}

export function normalizePhoneLast10(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export function canonicalCounty(value: string): string | null {
  return COUNTY_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}

/**
 * Parse and validate the request body. `idempotencyKey` is the Idempotency-Key
 * header; when both it and body.draftId are present they must match.
 */
export function parseEmpowerBumpBody(body: unknown, idempotencyKey?: string | null): ParseResult {
  if (!isPlainObject(body)) return { ok: false, error: 'Invalid request.' };
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, error: 'Invalid request.' };
  }

  const header = typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : undefined;
  const bodyDraft = body.draftId == null || body.draftId === '' ? undefined : body.draftId;
  if (bodyDraft !== undefined && typeof bodyDraft !== 'string') return { ok: false, error: 'Invalid draft id.' };
  if (header && bodyDraft && header !== bodyDraft) {
    return { ok: false, error: 'Idempotency-Key does not match draftId.' };
  }
  const draftId = (bodyDraft as string | undefined) ?? header;
  if (!draftId || !DRAFT_ID_PATTERN.test(draftId)) return { ok: false, error: 'Invalid draft id.' };

  if (typeof body.actedAt !== 'string' || !ISO_8601.test(body.actedAt) || !Number.isFinite(Date.parse(body.actedAt))) {
    return { ok: false, error: 'actedAt must be an ISO-8601 time.' };
  }
  const actedAt = body.actedAt;

  const leadId = requiredLine(body.leadId, 80);
  if (!leadId) return { ok: false, error: 'Lead id is required.' };
  const name = requiredLine(body.name, 120);
  if (!name) return { ok: false, error: 'Name is required.' };
  const phone = requiredLine(body.phone, 40);
  if (!phone) return { ok: false, error: 'Phone is required.' };
  const phoneLast10 = normalizePhoneLast10(phone);
  if (!phoneLast10) return { ok: false, error: 'Phone must have at least 10 digits.' };

  const email = optionalLine(body.email, 120);
  if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, error: 'Invalid email.' };
  }
  const address = optionalLine(body.address, 200);
  const city = optionalLine(body.city, 80);
  const town = optionalLine(body.town, 80);
  const zip = optionalLine(body.zip, 10);
  const stateRaw = optionalLine(body.state, 2);
  if (address === null || city === null || town === null) return { ok: false, error: 'Invalid address.' };
  if (zip === null || (zip && !/^\d{5}(-\d{4})?$/.test(zip))) return { ok: false, error: 'Invalid ZIP code.' };
  if (stateRaw === null || (stateRaw && !/^[A-Za-z]{2}$/.test(stateRaw))) return { ok: false, error: 'Invalid state.' };

  const countyRaw = optionalLine(body.county, 40);
  if (countyRaw === null) return { ok: false, error: 'Unknown county.' };
  let county: string | undefined;
  if (countyRaw) {
    const canonical = canonicalCounty(countyRaw);
    if (!canonical) return { ok: false, error: 'Unknown county.' };
    county = canonical;
  }

  const hh = body.householdSize;
  if (typeof hh !== 'number' || !Number.isInteger(hh) || hh < 1 || hh > 10) {
    return { ok: false, error: 'Household size must be 1 to 10.' };
  }

  let estimatedBand: EstimatedBand | undefined;
  if (body.estimatedBand != null && body.estimatedBand !== '') {
    if (typeof body.estimatedBand !== 'string' || !BANDS.has(body.estimatedBand as EstimatedBand)) {
      return { ok: false, error: 'Unknown estimated band.' };
    }
    estimatedBand = body.estimatedBand as EstimatedBand;
  }

  let assistancePrograms: string[] = [];
  if (body.assistancePrograms != null) {
    if (!Array.isArray(body.assistancePrograms) || body.assistancePrograms.length > ASSISTANCE_PROGRAMS.length) {
      return { ok: false, error: 'Unknown assistance program.' };
    }
    const seen = new Set<string>();
    for (const item of body.assistancePrograms) {
      if (typeof item !== 'string' || !ASSISTANCE_SET.has(item)) {
        return { ok: false, error: 'Unknown assistance program.' };
      }
      seen.add(item);
    }
    // Keep the Manual order regardless of tap order.
    assistancePrograms = ASSISTANCE_PROGRAMS.filter((label) => seen.has(label));
  }

  let assistanceNone = false;
  if (body.assistanceNone != null) {
    if (typeof body.assistanceNone !== 'boolean') return { ok: false, error: 'Invalid request.' };
    assistanceNone = body.assistanceNone;
  }
  if (assistanceNone && assistancePrograms.length > 0) {
    return { ok: false, error: 'Pick None or programs, not both.' };
  }

  let annualHouseholdIncome: number | undefined;
  if (body.annualHouseholdIncome != null && body.annualHouseholdIncome !== '') {
    const income = body.annualHouseholdIncome;
    if (typeof income !== 'number' || !Number.isFinite(income) || income < 0 || income > MAX_ANNUAL_INCOME) {
      return { ok: false, error: 'Invalid annual household income.' };
    }
    annualHouseholdIncome = income;
  }

  // Spec: county is required when a band other than not_sure is sent.
  if (estimatedBand && estimatedBand !== 'not_sure' && !county) {
    return { ok: false, error: 'County is required for this band.' };
  }

  const repName = optionalLine(body.repName, 80);
  if (repName === null) return { ok: false, error: 'Invalid rep name.' };

  return {
    ok: true,
    value: {
      draftId,
      actedAt,
      leadId,
      name,
      phone,
      phoneLast10,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      state: stateRaw ? stateRaw.toUpperCase() : undefined,
      zip: zip || undefined,
      town: town || city || undefined,
      county,
      householdSize: hh,
      estimatedBand,
      assistancePrograms,
      assistanceNone,
      annualHouseholdIncome,
      repName: repName || undefined,
    },
  };
}

export type IncomeLimits = { tier1Limit: number; tier3Cap: number };

export function incomeLimitsFor(county: string, householdSize: number): IncomeLimits | null {
  const row = EMPOWER_INCOME_LIMITS[county];
  if (!row || !Number.isInteger(householdSize) || householdSize < 1 || householdSize > 10) return null;
  return { tier1Limit: row.tier1[householdSize - 1], tier3Cap: row.tier3[householdSize - 1] };
}

/**
 * Charles override (Evan, Nov 23 2026): Tier 1 is income <= L; Tier 3 is
 * L < income <= M; Comfort Home is income > M. Exactly at M is still Tier 3.
 */
export function bandForIncome(county: string, householdSize: number, income: number): Exclude<EstimatedBand, 'not_sure'> | null {
  const limits = incomeLimitsFor(county, householdSize);
  if (!limits || !Number.isFinite(income) || income < 0) return null;
  if (income <= limits.tier1Limit) return 'tier1';
  if (income <= limits.tier3Cap) return 'tier3';
  return 'comfort_home';
}

export type ResolvedBand = {
  /** null when the client sent no band, no programs, and no exact income. */
  band: EstimatedBand | null;
  categorical: boolean;
  source: 'assistance' | 'income' | 'client' | 'none';
};

/**
 * Server-side band. Any assistance program forces tier1 (categorical). An exact
 * income, when sent, is mapped with the county limits and wins over the
 * client's pick. Otherwise the client's band is used as sent.
 */
export function resolveBand(req: EmpowerBumpRequest): ResolvedBand {
  if (req.assistancePrograms.length > 0) return { band: 'tier1', categorical: true, source: 'assistance' };
  if (req.annualHouseholdIncome !== undefined && req.county) {
    const band = bandForIncome(req.county, req.householdSize, req.annualHouseholdIncome);
    if (band) return { band, categorical: false, source: 'income' };
  }
  if (req.estimatedBand) return { band: req.estimatedBand, categorical: false, source: 'client' };
  return { band: null, categorical: false, source: 'none' };
}

/** The only values the official Empower Tier picklists accept. */
export function officialEmpowerTier(band: EstimatedBand | null): 'Tier 1' | 'Tier 3' | null {
  if (band === 'tier1') return 'Tier 1';
  if (band === 'tier3') return 'Tier 3';
  return null;
}

/**
 * Official Empower Tier write rule (Charles QA, Nov 23 2026), applied to the
 * contact and the opportunity separately:
 * - Comfort Home, Not sure, or no band: never write.
 * - Assistance programs (categorical Tier 1): write Tier 1, even over Tier 3.
 * - Any other estimate: write only when the field is currently empty.
 * So Tier 1 is never downgraded to Tier 3, and a non-assistance estimate never
 * overwrites a non-empty official tier.
 */
export function officialTierToWrite(resolved: ResolvedBand, current: unknown): 'Tier 1' | 'Tier 3' | null {
  const official = officialEmpowerTier(resolved.band);
  if (!official) return null;
  if (resolved.categorical && official === 'Tier 1') {
    return current === 'Tier 1' ? null : 'Tier 1';
  }
  return isEmptyFieldValue(current) ? official : null;
}

export function isEmptyFieldValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Discord label. No band at all shows as Not sure. */
export function estimatedTierLabel(band: EstimatedBand | null): string {
  return band ? ESTIMATED_BAND_LABELS[band] : ESTIMATED_BAND_LABELS.not_sure;
}

/** Dollar amounts for published NYSERDA brackets. Not a raw household income. */
export function formatEmpowerDollars(amount: number): string {
  const digits = Math.trunc(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}$${digits}`;
}

/**
 * The income choice the form shows: the estimated tier, plus the published
 * dollar range when county and household size are known. Never a raw
 * annualHouseholdIncome figure.
 */
export function incomeSelectionLabel(input: {
  band: EstimatedBand | null;
  county?: string;
  householdSize?: number;
}): string {
  const base = estimatedTierLabel(input.band);
  if (!input.band || input.band === 'not_sure' || !input.county || !input.householdSize) return base;
  const limits = incomeLimitsFor(input.county, input.householdSize);
  if (!limits) return base;
  if (input.band === 'tier1') return `${base} — at or under ${formatEmpowerDollars(limits.tier1Limit)}`;
  if (input.band === 'tier3') {
    return `${base} — above ${formatEmpowerDollars(limits.tier1Limit)} and at or under ${formatEmpowerDollars(limits.tier3Cap)}`;
  }
  return `${base} — above ${formatEmpowerDollars(limits.tier3Cap)}`;
}

/** GHL-STORAGE-PROPOSAL.md §4. No phone, no email, no dollars unless an exact amount was typed. */
export function buildContactNote(req: EmpowerBumpRequest, resolved: ResolvedBand, options: { keptOfficialTier?: string | null } = {}): string {
  const lines = [
    'Empower Bump (estimate only; final tier set from income documents).',
    `Estimated band: ${resolved.band ? ESTIMATED_BAND_LABELS[resolved.band] : '(not selected)'}`,
    `Household size: ${req.householdSize}`,
    `County used: ${req.county ?? '(not provided)'}`,
    `Government assistance: ${req.assistancePrograms.length ? req.assistancePrograms.join(', ') : 'None'}`,
    `Categorical Tier 1: ${resolved.categorical ? 'yes' : 'no'}`,
  ];
  if (req.annualHouseholdIncome !== undefined) {
    lines.push(`Annual household income (typed by rep): $${Math.round(req.annualHouseholdIncome).toLocaleString('en-US')}`);
  }
  if (options.keptOfficialTier) {
    lines.push(`Official Empower Tier left unchanged at ${options.keptOfficialTier}.`);
  }
  return lines.join('\n');
}

export function neutralizeMentions(value: string): string {
  return value.replace(/@(everyone|here)/gi, '@\u200b$1');
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** A later Empower Status is never moved back to Portal Creation Needed. */
export function shouldWriteEmpowerStatus(current: unknown): boolean {
  if (current == null) return true;
  if (typeof current !== 'string') return false;
  const value = current.trim();
  if (!value) return true;
  return false; // already Portal Creation Needed (no-op) or later/unknown (leave it)
}
