import { EMPOWER_INCOME_LIMITS_CSV } from "./incomeLimitsCsv";

/** Default disposition id. Counted by isCountedKnock; not a go-back. */
export const EMPOWER_BUMP_ID = "empower-bump";

/** NYSERDA published EmPower+ household sizes. There is no 11+ row. */
export const EMPOWER_MAX_HOUSEHOLD = 10;

export const ESTIMATE_NOTE = "Estimated, final tier set from income documents";

export const ASSISTANCE_HELPER =
  "A household member over 18 who receives one of these, with an award letter or benefit statement from the last 12 months, is estimated as Tier 1. Final tier is set from income documents.";

/** Shown under SSI. Not part of the program label. */
export const SSI_HELPER = "SSI is not Social Security Retirement or Disability.";

export const CATEGORICAL_TIER1_NOTE =
  "A selected assistance program estimates this household as Tier 1 (est.). Estimated, final tier set from income documents.";

export const NOT_SURE_LABEL = "Not sure";

/** Exact labels, in order. None is separate and cannot be combined with these. */
export const ASSISTANCE_PROGRAMS = [
  "HEAP (Home Energy Assistance Program)",
  "SNAP (Supplemental Nutrition Assistance Program/Food Stamps)/SNAP NYC",
  "SSI (Supplemental Security Income)",
  "TANF (Temporary Assistance for Needy Families)",
  "Weatherization Assistance Program",
  "Public Assistance",
] as const;

export type AssistanceProgram = (typeof ASSISTANCE_PROGRAMS)[number];

/** The 62 New York counties, including St. Lawrence and New York. */
export const NY_COUNTIES = [
  "Albany",
  "Allegany",
  "Bronx",
  "Broome",
  "Cattaraugus",
  "Cayuga",
  "Chautauqua",
  "Chemung",
  "Chenango",
  "Clinton",
  "Columbia",
  "Cortland",
  "Delaware",
  "Dutchess",
  "Erie",
  "Essex",
  "Franklin",
  "Fulton",
  "Genesee",
  "Greene",
  "Hamilton",
  "Herkimer",
  "Jefferson",
  "Kings",
  "Lewis",
  "Livingston",
  "Madison",
  "Monroe",
  "Montgomery",
  "Nassau",
  "New York",
  "Niagara",
  "Oneida",
  "Onondaga",
  "Ontario",
  "Orange",
  "Orleans",
  "Oswego",
  "Otsego",
  "Putnam",
  "Queens",
  "Rensselaer",
  "Richmond",
  "Rockland",
  "Saratoga",
  "Schenectady",
  "Schoharie",
  "Schuyler",
  "Seneca",
  "St. Lawrence",
  "Steuben",
  "Suffolk",
  "Sullivan",
  "Tioga",
  "Tompkins",
  "Ulster",
  "Warren",
  "Washington",
  "Wayne",
  "Westchester",
  "Wyoming",
  "Yates",
] as const;

export type NyCounty = (typeof NY_COUNTIES)[number];
export type EstimatedBand = "tier1" | "tier3" | "comfort_home" | "not_sure";

export interface IncomeLimits {
  tier1: number;
  tier3: number;
}

export interface IncomeTable {
  counties: readonly string[];
  limits: ReadonlyMap<string, IncomeLimits>;
}

const FIELD_ROLES = new Set(["setter", "closer", "manager", "admin"]);

export function canOfferEmpowerBump(input: {
  role?: string | null;
  contactRedacted?: boolean;
}): boolean {
  if (input.contactRedacted === true) return false;
  return FIELD_ROLES.has(input.role ?? "");
}

export function canonicalCounty(value: unknown): NyCounty | "" {
  const text = cleanText(value).toLowerCase();
  if (!text) return "";
  return NY_COUNTIES.find((name) => name.toLowerCase() === text) ?? "";
}

/**
 * Prefill only when the county is already written on the door.
 * A zip-to-county table is out of scope. "Erie" alone is not Erie County.
 */
export function knownCounty(source: {
  county?: unknown;
  address?: unknown;
  city?: unknown;
  municipality?: unknown;
  town?: unknown;
}): string {
  const direct = canonicalCounty(source.county);
  if (direct) return direct;
  const blob = [source.address, source.city, source.municipality, source.town]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join("\n");
  if (!blob) return "";
  for (const name of NY_COUNTIES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|\\W)${escaped}\\s+County\\b`, "i").test(blob)) return name;
  }
  return "";
}

export function formatDollars(amount: number): string {
  const digits = Math.trunc(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}$${digits}`;
}

export function tier1Label(limits: IncomeLimits): string {
  return `Tier 1 (est.) — at or under ${formatDollars(limits.tier1)}. ${ESTIMATE_NOTE}`;
}

export function tier3Label(limits: IncomeLimits): string {
  return `Tier 3 (est.) — above ${formatDollars(limits.tier1)} and at or under ${formatDollars(limits.tier3)}. ${ESTIMATE_NOTE}`;
}

export function comfortLabel(limits: IncomeLimits): string {
  return `Comfort Home (est.) — above ${formatDollars(limits.tier3)}. ${ESTIMATE_NOTE}`;
}

export interface BandChoice {
  id: EstimatedBand;
  label: string;
}

/** Dollar bands exist only after a published county and household size are chosen. Not sure is always offered. */
export function bandChoices(county: string, householdSize: number, table = incomeTable()): BandChoice[] {
  const limits = limitsFor(county, householdSize, table);
  const notSure: BandChoice = { id: "not_sure", label: NOT_SURE_LABEL };
  if (!limits) return [notSure];
  return [
    { id: "tier1", label: tier1Label(limits) },
    { id: "tier3", label: tier3Label(limits) },
    { id: "comfort_home", label: comfortLabel(limits) },
    notSure,
  ];
}

/**
 * L is Tier 1 (60%). M is Tier 3 (80%).
 * At L is Tier 1. At M is still Tier 3. Comfort Home is strictly above M.
 */
export function bandForIncome(income: number, limits: IncomeLimits): Exclude<EstimatedBand, "not_sure"> {
  if (!Number.isFinite(income)) throw new Error("Income must be a finite number.");
  if (income <= limits.tier1) return "tier1";
  if (income <= limits.tier3) return "tier3";
  return "comfort_home";
}

export function programsForceTier1(programs: readonly string[]): boolean {
  return programs.length > 0;
}

export function parseIncomeLimitCsv(csv: string): IncomeTable {
  const text = csv.replace(/^\uFEFF/, "").trim();
  const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = rows[0]?.split(",").map((cell) => cell.trim());
  if (header?.join(",") !== "county,household_size,tier1_60pct,tier3_80pct") {
    throw new Error("Income limit CSV header does not match the published table.");
  }
  const limits = new Map<string, IncomeLimits>();
  const counties: string[] = [];
  for (const line of rows.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.length !== 4) throw new Error("Income limit row is missing a column.");
    const county = canonicalCounty(cells[0]);
    const size = Number(cells[1]);
    const tier1 = Number(cells[2]);
    const tier3 = Number(cells[3]);
    if (!county) throw new Error(`Unknown county in the income table: ${cells[0]}`);
    if (!Number.isInteger(size) || size < 1 || size > EMPOWER_MAX_HOUSEHOLD) {
      throw new Error(`Household size ${cells[1]} is outside 1–${EMPOWER_MAX_HOUSEHOLD}.`);
    }
    if (!Number.isInteger(tier1) || !Number.isInteger(tier3) || tier3 <= tier1) {
      throw new Error(`Limits for ${county} household ${size} are not usable.`);
    }
    const key = limitKey(county, size);
    if (limits.has(key)) throw new Error(`Duplicate limits for ${county} household ${size}.`);
    if (!counties.includes(county)) counties.push(county);
    limits.set(key, { tier1, tier3 });
  }
  if (counties.length !== NY_COUNTIES.length) throw new Error("The income table does not cover 62 counties.");
  for (const county of NY_COUNTIES) {
    for (let size = 1; size <= EMPOWER_MAX_HOUSEHOLD; size += 1) {
      if (!limits.has(limitKey(county, size))) throw new Error(`Missing ${county} household ${size}.`);
    }
  }
  return { counties, limits };
}

let cached: IncomeTable | null = null;

export function incomeTable(csv = EMPOWER_INCOME_LIMITS_CSV): IncomeTable {
  if (csv === EMPOWER_INCOME_LIMITS_CSV && cached) return cached;
  const parsed = parseIncomeLimitCsv(csv);
  if (csv === EMPOWER_INCOME_LIMITS_CSV) cached = parsed;
  return parsed;
}

export function limitsFor(county: string, householdSize: number, table = incomeTable()): IncomeLimits | null {
  const name = canonicalCounty(county);
  if (!name || !Number.isInteger(householdSize) || householdSize < 1 || householdSize > EMPOWER_MAX_HOUSEHOLD) {
    return null;
  }
  return table.limits.get(limitKey(name, householdSize)) ?? null;
}

export interface EmpowerBumpPayload {
  draftId: string;
  actedAt: string;
  leadId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  town?: string;
  county?: string;
  householdSize: number;
  estimatedBand: EstimatedBand;
  assistancePrograms?: AssistanceProgram[];
  assistanceNone: boolean;
  repName?: string;
}

export interface EmpowerBumpDraftInput {
  draftId: string;
  /** Original action time, captured before GPS or network work. */
  actedAt: string;
  leadId: string;
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  town?: string;
  county?: string;
  householdSize: number;
  estimatedBand: EstimatedBand | "";
  assistancePrograms: readonly string[];
  assistanceNone: boolean;
  confirmedContact: boolean;
  repName?: string;
}

export type EmpowerBumpBuild =
  | { ok: true; payload: EmpowerBumpPayload }
  | { ok: false; message: string };

/** Name, phone, and email written onto the local door. Email is required on a bump. */
export function empowerContactPatch(payload: Pick<EmpowerBumpPayload, "name" | "phone" | "email">): {
  name: string;
  phone: string;
  email: string;
} {
  return { name: payload.name, phone: payload.phone, email: payload.email };
}

/** Same liberal check as the office route: something@domain.tld, no spaces, up to 120 characters. */
export const EMPOWER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function normalizeEmpowerEmail(value: unknown): string {
  return cleanText(value);
}

export function isValidEmpowerEmail(value: unknown): boolean {
  const email = normalizeEmpowerEmail(value);
  return email.length > 0 && email.length <= 120 && EMPOWER_EMAIL_PATTERN.test(email);
}

/** States whose USPS ZIP prefixes start with 0, so a short numeric value lost leading zeros. NY starts with 1 — do not pad those. */
export const ZERO_PREFIX_ZIP_STATES = new Set(["CT", "MA", "ME", "NH", "NJ", "RI", "VT", "PR", "VI"]);

function stateCode(value: unknown): string {
  const text = cleanText(value).toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : "";
}

/** Normalize a ZIP or ZIP+4 into the office format (##### or #####-####). Empty if it cannot be used. */
export function normalizeEmpowerZip(value: unknown, state?: unknown): string {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(Math.trunc(value))
    : cleanText(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (/^\d{5}-\d{4}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9 && /^\d{9}$/.test(raw.replace(/-/g, ""))) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  if (digits.length === 5) return digits;
  if (digits.length > 0 && digits.length < 5 && ZERO_PREFIX_ZIP_STATES.has(stateCode(state))) {
    return digits.padStart(5, "0");
  }
  return "";
}

/** Pull a ZIP from an address or city/state line, avoiding a leading house number. */
export function zipFromText(value: unknown, state?: unknown): string {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : String(value ?? "");
  if (!text) return "";
  const afterState = text.match(/\b([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?|\d{9})\b/);
  if (afterState) return normalizeEmpowerZip(afterState[2], afterState[1]);
  const atEnd = text.match(/(?:^|[\s,])(\d{5}(?:-\d{4})?|\d{9})\s*$/);
  if (atEnd) return normalizeEmpowerZip(atEnd[1], state);
  return "";
}

export type EmpowerZipSource = {
  zip?: unknown;
  postalCode?: unknown;
  zipCode?: unknown;
  zipcode?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  homeowner?: {
    mailingZip?: unknown;
    address?: unknown;
    addressNorm?: unknown;
    state?: unknown;
  } | null;
};

/**
 * ZIP for a bump, from lead or property data. Manual pins usually have lead.zip;
 * unvisited homeowner pins keep lead.zip empty and store mailingZip / a ZIP in the address.
 */
export function resolveEmpowerZip(input: EmpowerZipSource): string {
  const state = input.state ?? input.homeowner?.state;
  for (const field of [input.zip, input.postalCode, input.zipCode, input.zipcode]) {
    const zip = normalizeEmpowerZip(field, state);
    if (zip) return zip;
  }
  for (const text of [
    input.address,
    [input.address, input.city, input.state].filter((part) => part != null && String(part).trim() !== "").join(", "),
    input.homeowner?.address,
    input.homeowner?.addressNorm,
  ]) {
    const zip = zipFromText(text, state);
    if (zip) return zip;
  }
  return normalizeEmpowerZip(input.homeowner?.mailingZip, state);
}

export function buildEmpowerBumpPayload(input: EmpowerBumpDraftInput, table = incomeTable()): EmpowerBumpBuild {
  const problems: string[] = [];
  const draftId = cleanText(input.draftId);
  const actedAt = cleanText(input.actedAt);
  const leadId = cleanText(input.leadId);
  const name = cleanText(input.name);
  const phone = cleanText(input.phone);
  const email = normalizeEmpowerEmail(input.email);
  const address = cleanText(input.address);
  const city = cleanText(input.city);
  const state = cleanText(input.state).toUpperCase();
  const town = cleanText(input.town);
  const zip = normalizeEmpowerZip(input.zip, state);
  const county = canonicalCounty(input.county);
  const householdSize = input.householdSize;
  const programs = normalizePrograms(input.assistancePrograms);
  const assistanceNone = input.assistanceNone === true;

  if (!input.confirmedContact) problems.push("Confirm the name, phone, and email");
  if (!/^\S{1,80}$/.test(draftId)) problems.push("Draft id");
  if (!actedAt || !Number.isFinite(Date.parse(actedAt))) problems.push("Action time");
  if (!leadId || leadId.length > 120) problems.push("Lead");
  if (name.length < 1 || name.length > 120) problems.push("Name (1–120 characters)");
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 10 || phone.length > 40) problems.push("Phone (at least 10 digits)");
  if (!isValidEmpowerEmail(email)) problems.push("Email (a real address, like name@domain.com)");
  if (address.length < 1 || address.length > 200) problems.push("Street address");
  if (city.length < 1 || city.length > 80) problems.push("City");
  if (!/^[A-Z]{2}$/.test(state)) problems.push("State (2 letters)");
  if (!/^\d{5}(-\d{4})?$/.test(zip)) problems.push("ZIP (5 digits or ZIP+4)");
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > EMPOWER_MAX_HOUSEHOLD) {
    problems.push(`Household members (1–${EMPOWER_MAX_HOUSEHOLD})`);
  }
  if (programs === "invalid") problems.push("Assistance programs");
  if (assistanceNone && programs !== "invalid" && programs.length > 0) {
    problems.push("None cannot be combined with an assistance program");
  }
  if (!assistanceNone && (programs === "invalid" || programs.length === 0)) {
    problems.push("Choose None or the assistance that applies");
  }

  const selected: EstimatedBand = programs !== "invalid" && programsForceTier1(programs)
    ? "tier1"
    : input.estimatedBand || "not_sure";
  if (selected !== "not_sure") {
    if (!county) problems.push("County");
    else if (!limitsFor(county, householdSize, table)) problems.push("Income band for that county and household size");
  } else if (input.county && !county) {
    problems.push("County");
  }

  if (problems.length > 0) return { ok: false, message: `Fix these before saving: ${problems.join(", ")}` };

  const payload: EmpowerBumpPayload = {
    draftId,
    actedAt,
    leadId,
    name,
    phone,
    email,
    address,
    city,
    state,
    zip,
    householdSize,
    estimatedBand: selected,
    assistanceNone: assistanceNone && programs !== "invalid" && programs.length === 0,
  };
  if (town) payload.town = town;
  if (county) payload.county = county;
  if (programs !== "invalid" && programs.length > 0) payload.assistancePrograms = programs;
  const repName = cleanText(input.repName);
  if (repName) payload.repName = repName.slice(0, 120);
  return { ok: true, payload };
}

function normalizePrograms(values: readonly string[]): AssistanceProgram[] | "invalid" {
  const picked: AssistanceProgram[] = [];
  for (const value of values) {
    const label = ASSISTANCE_PROGRAMS.find((program) => program === cleanText(value));
    if (!label) return "invalid";
    if (!picked.includes(label)) picked.push(label);
  }
  return ASSISTANCE_PROGRAMS.filter((program) => picked.includes(program));
}

function limitKey(county: string, size: number): string {
  return `${county}|${size}`;
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === "\"" && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else if (char === "\"") quoted = false;
      else current += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}
