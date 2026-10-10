import {
  DEFAULT_FIELD_CONFIG,
  FEATURE_KEYS,
  type FieldConfig,
  type SavingsAssumptions,
} from "./types";

const text = (x: unknown, max = 300) =>
  typeof x === "string" ? x.trim().slice(0, max) : "";
const number = (x: unknown, low: number, high: number, fallback: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= low && x <= high
    ? x
    : fallback;
export function httpsUrl(x: unknown) {
  try {
    const u = new URL(String(x));
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch {
    return "";
  }
}
function assumptions(x: unknown): SavingsAssumptions | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  const fields: Record<string, [number, number]> = {
    panelWatts: [100, 1000],
    annualKwhPerKwLow: [100, 2500],
    annualKwhPerKwHigh: [100, 2500],
    avoidedRateLow: [0, 2],
    avoidedRateHigh: [0, 2],
    monthlyPaymentPerKwLow: [0, 100],
    monthlyPaymentPerKwHigh: [0, 100],
    fixedMonthlyCharge: [0, 1000],
    selfConsumption: [0, 1],
    exportRate: [0, 2],
  };
  const n: Record<string, number> = {};
  for (const [key, [min, max]] of Object.entries(fields)) {
    n[key] = number(a[key], min, max, NaN);
    if (!Number.isFinite(n[key])) return null;
  }
  if (
    n.annualKwhPerKwLow > n.annualKwhPerKwHigh ||
    n.avoidedRateLow > n.avoidedRateHigh ||
    n.monthlyPaymentPerKwLow > n.monthlyPaymentPerKwHigh
  )
    return null;
  if (
    !/^\d{4}-\d{2}-\d{2}/.test(text(a.approvedAt)) ||
    !Number.isFinite(Date.parse(text(a.approvedAt))) ||
    !/^[A-Z]{2}$/.test(text(a.state).toUpperCase())
  )
    return null;
  return {
    ...n,
    approved: a.approved === true,
    approvedAt: text(a.approvedAt, 30),
    source: text(a.source, 1000),
    state: text(a.state, 2).toUpperCase(),
  } as SavingsAssumptions;
}
/** Strict allowlist. Never return stored secrets or arbitrary configuration fields. */
export function cleanConfig(input: unknown): FieldConfig {
  const c = (
    input && typeof input === "object" ? input : {}
  ) as Partial<FieldConfig>;
  const startHour = Math.floor(number(c.startHour, 0, 22, 10));
  let publicOrigin = "";
  try {
    const u = new URL(httpsUrl(c.publicOrigin));
    publicOrigin = u.origin;
  } catch {}
  return {
    ...DEFAULT_FIELD_CONFIG,
    version: text(c.version, 100) || "0",
    experiment: text(c.experiment, 60) || "field-v11",
    pilotPercent: Math.floor(number(c.pilotPercent, 0, 100, 0)),
    enabled: Object.fromEntries(
      FEATURE_KEYS.map((k) => [k, c.enabled?.[k] === true]),
    ) as FieldConfig["enabled"],
    allowedUsers: Array.isArray(c.allowedUsers)
      ? c.allowedUsers
          .filter((x) => typeof x === "string" && /^[\w-]{1,128}$/.test(x))
          .slice(0, 2000)
      : [],
    startHour,
    endHour: Math.floor(
      number(c.endHour, startHour + 1, 24, Math.max(startHour + 1, 19)),
    ),
    maxAttempts: Math.floor(number(c.maxAttempts, 1, 5, 3)),
    minTimingAttempts: Math.floor(number(c.minTimingAttempts, 20, 200, 20)),
    maxCacheDoors: Math.floor(number(c.maxCacheDoors, 50, 1000, 750)),
    openers: Array.isArray(c.openers)
      ? c.openers
          .filter((x) => x && typeof x === "object")
          .slice(0, 12)
          .map((x) => ({
            id: text(x.id, 60),
            label: text(x.label, 80),
            approvedTip: text(x.approvedTip, 250),
          }))
          .filter((x) => x.id && x.label)
      : [],
    proof: Array.isArray(c.proof)
      ? c.proof
          .filter((x) => x && typeof x === "object")
          .slice(0, 50)
          .map((x) => ({
            id: text(x.id, 60),
            title: text(x.title, 100),
            city: text(x.city, 80),
            state: text(x.state, 2).toUpperCase(),
            quote: text(x.quote, 500),
            imageUrl: httpsUrl(x.imageUrl),
            sourceUrl: httpsUrl(x.sourceUrl),
            permission: x.permission === true,
            approved: x.approved === true,
            verifiedAt: text(x.verifiedAt, 30),
            ...(Number.isFinite(x.lat) &&
            Number.isFinite(x.lng) &&
            Math.abs(x.lat!) <= 90 &&
            Math.abs(x.lng!) <= 180
              ? { lat: x.lat, lng: x.lng }
              : {}),
          }))
          .filter(
            (x) =>
              x.id &&
              x.title &&
              x.approved &&
              x.permission &&
              Number.isFinite(Date.parse(x.verifiedAt)),
          )
      : [],
    savings: assumptions(c.savings),
    publicOrigin,
    bookingUrl: httpsUrl(c.bookingUrl),
    bookingAttributionVerified: c.bookingAttributionVerified === true,
    schedulingPhone: text(c.schedulingPhone, 30).replace(/[^+\d]/g, ""),
  };
}
