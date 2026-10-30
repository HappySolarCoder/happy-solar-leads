/** Shared hot-lead ids and roles. Both the API and field dispo import this. */

export const HOT_LEAD_ID_RE = /^ghl_[A-Za-z0-9_-]{1,120}$/;

/** Map page size. One lat-range read, then the existing after/afterLat cursor. */
export const HOT_LEADS_PAGE = 200;

const HOT_LEAD_ROLES = new Set(['closer', 'manager', 'admin']);

export function isHotLeadId(id: string): boolean {
  return HOT_LEAD_ID_RE.test(id);
}

export function isHotLeadRole(role: string): boolean {
  return HOT_LEAD_ROLES.has(role);
}
