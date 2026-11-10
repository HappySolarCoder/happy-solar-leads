import { apiFetch } from '@/app/utils/apiFetch';
import { isDeviceOnline } from '@/app/utils/connectivity';
import { auth } from '@/app/utils/firebase';
import { territoryCheckNeeded, territoryWarningCancelled } from '@/app/mobile/_lib/ownerCounts';

export const TERRITORY_CHECK_PATH = '/api/field/territory-check';
/** Whole budget: token read plus the request. */
export const TERRITORY_CHECK_TIMEOUT_MS = 1500;
/** After 404/405 only (route not deployed yet). */
export const TERRITORY_CHECK_BACKOFF_MS = 15 * 60 * 1000;

export type TerritoryCheckResult = {
  ownership: 'legacy' | 'territory';
  warn: boolean;
  popupExempt: boolean;
  inOtherUsersTerritory: boolean;
  owners: { uid: string; name: string | null }[];
};

export type TerritoryCheckDeps = {
  online?: () => boolean;
  currentUid?: () => string | null;
  getToken?: () => Promise<string | null>;
  send?: typeof apiFetch;
  now?: () => number;
  timeoutMs?: number;
};

const OWNERS_MAX = 5;
let backoffUntil = 0;

export function resetTerritoryCheckForTests(): void {
  backoffUntil = 0;
}

function finiteCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function parseOwners(value: unknown): { uid: string; name: string | null }[] | null {
  if (!Array.isArray(value)) return null;
  const owners: { uid: string; name: string | null }[] = [];
  for (const item of value) {
    if (owners.length >= OWNERS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as { uid?: unknown; name?: unknown };
    if (typeof row.uid !== 'string' || row.uid.length === 0) continue;
    if (row.name !== null && typeof row.name !== 'string') continue;
    owners.push({ uid: row.uid, name: row.name });
  }
  return owners;
}

/** Server `message` is ignored. `warn` is trusted only for a non-exempt territory verdict. */
export function parseTerritoryCheck(body: unknown): TerritoryCheckResult | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (row.ok !== true) return null;
  if (row.ownership !== 'legacy' && row.ownership !== 'territory') return null;
  if (typeof row.warn !== 'boolean' || typeof row.popupExempt !== 'boolean' || typeof row.inOtherUsersTerritory !== 'boolean') {
    return null;
  }
  const owners = parseOwners(row.owners);
  if (!owners) return null;
  const warn = row.ownership === 'territory' && row.warn === true && row.popupExempt !== true;
  return {
    ownership: row.ownership,
    warn,
    popupExempt: row.popupExempt,
    inOtherUsersTerritory: row.inOtherUsersTerritory,
    owners,
  };
}

async function defaultToken(): Promise<string | null> {
  return (await auth?.currentUser?.getIdToken()) ?? null;
}

/**
 * Never throws. null means no verdict: the caller places the pin with no popup.
 * One deadline covers the token read and the request. A late response cannot warn.
 */
export async function checkNewPinTerritory(
  input: { uid: string; lat: number; lng: number },
  deps?: TerritoryCheckDeps,
): Promise<TerritoryCheckResult | null> {
  const online = deps?.online ?? isDeviceOnline;
  const currentUid = deps?.currentUid ?? (() => auth?.currentUser?.uid ?? null);
  const getToken = deps?.getToken ?? defaultToken;
  const send = deps?.send ?? apiFetch;
  const now = deps?.now ?? Date.now;
  const timeoutMs = deps?.timeoutMs ?? TERRITORY_CHECK_TIMEOUT_MS;

  if (!input.uid) return null;
  if (!finiteCoord(input.lat, input.lng)) return null;
  if (!online()) return null;
  if (currentUid() !== input.uid) return null;
  if (now() < backoffUntil) return null;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });

  const attempt = (async (): Promise<TerritoryCheckResult | null> => {
    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      return null;
    }
    if (controller.signal.aborted || !token) return null;
    try {
      const response = await send(TERRITORY_CHECK_PATH, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lat: input.lat, lng: input.lng }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return null;
      if (response.status === 404 || response.status === 405) {
        backoffUntil = now() + TERRITORY_CHECK_BACKOFF_MS;
        return null;
      }
      if (!response.ok) return null;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return null;
      }
      if (controller.signal.aborted) return null;
      return parseTerritoryCheck(body);
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function guardNewPinTerritory(input: {
  uid: string;
  lat?: number;
  lng?: number;
  confirm: () => boolean;
  deps?: TerritoryCheckDeps;
}): Promise<{ checked: boolean; warned: boolean }> {
  if (!territoryCheckNeeded(input.uid) || typeof input.lat !== 'number' || typeof input.lng !== 'number') {
    return { checked: false, warned: false };
  }
  const verdict = await checkNewPinTerritory(
    { uid: input.uid, lat: input.lat, lng: input.lng },
    input.deps,
  );
  if (verdict?.warn === true) {
    if (!input.confirm()) throw territoryWarningCancelled();
    return { checked: true, warned: true };
  }
  return { checked: true, warned: false };
}

/**
 * Save-time stamps for a dropped pin.
 * When the guard ran, createdAt is the tap (`placedAt`) and the disposition
 * fallbacks are the tap (`actedAt`). Otherwise each fallback is `new Date()`.
 */
export function pinSaveTimestamps(input: {
  checked: boolean;
  actedAt: Date;
  placedAt: Date;
  dispositionedAt?: Date;
  manualDisposition: boolean;
  now?: () => Date;
}): { createdAt: Date; dispositionedAt?: Date; historyTimestamp: Date } {
  const now = input.now ?? (() => new Date());
  const createdAt = input.checked ? input.placedAt : now();
  const dispositionedAt = input.manualDisposition
    ? (input.dispositionedAt || (input.checked ? input.actedAt : now()))
    : input.dispositionedAt;
  const historyTimestamp = input.dispositionedAt || (input.checked ? input.actedAt : now());
  return { createdAt, dispositionedAt, historyTimestamp };
}
