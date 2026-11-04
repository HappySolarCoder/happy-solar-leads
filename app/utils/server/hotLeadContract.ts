/** Shared hot-lead ids and roles. Both the API and field dispo import this. */

import { AsyncLocalStorage } from 'node:async_hooks';

export const HOT_LEAD_ID_RE = /^ghl_[A-Za-z0-9_-]{1,120}$/;

/** Map page size. One lat-range read, then the existing after/afterLat cursor. */
export const HOT_LEADS_PAGE = 200;

export const HOT_LEAD_ROLE_SETS = {
  A: ['closer', 'manager', 'admin'],
  B: ['setter', 'closer', 'manager', 'admin'],
} as const;

export const HOT_LEAD_ROLE_VARIANT: 'A' | 'B' = 'A';

const HOT_LEAD_ROLES = new Set<string>(HOT_LEAD_ROLE_SETS[HOT_LEAD_ROLE_VARIANT]);

const roleOverride = new AsyncLocalStorage<ReadonlySet<string>>();

export function isHotLeadId(id: string): boolean {
  return HOT_LEAD_ID_RE.test(id);
}

export function isHotLeadRole(role: string): boolean {
  return (roleOverride.getStore() ?? HOT_LEAD_ROLES).has(role);
}

/** Tests inject one variant's role set. Production never calls this. */
export function withHotLeadRoles<T>(roles: readonly string[], fn: () => T): T {
  return roleOverride.run(new Set<string>(roles), fn);
}
