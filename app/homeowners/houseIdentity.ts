import type { Lead, LeadDispositionHistoryEntry } from '@/app/types';

const aliases: Record<string, string> = { STREET:'ST', ROAD:'RD', AVENUE:'AVE', DRIVE:'DR', LANE:'LN', COURT:'CT', PLACE:'PL', BOULEVARD:'BLVD', CIRCLE:'CIR', TERRACE:'TER', PARKWAY:'PKWY', HIGHWAY:'HWY', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W' };
const clean = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9\s]/g,' ').trim().replace(/\s+/g,' ');
export function houseStreet(value: unknown) {
  // Geocoders sometimes put the full postal address in the street field.
  return clean(String(value || '').split(',')[0].replace(/(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\b|#).*$/i,''))
    .split(' ').map(w => aliases[w] || w).join(' ');
}
export function eventMillis(value: unknown): number {
  if (!value) return 0;
  const v = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  const n = typeof v.toMillis === 'function' ? v.toMillis() : typeof v.seconds === 'number'
    ? v.seconds * 1000 + (v.nanoseconds || 0) / 1e6 : new Date(value as string).getTime();
  return Number.isFinite(n) ? n : 0;
}
const unworked = new Set(['','assigned','unassigned','unclaimed','claimed','new','not-knocked','available']);
export function latestVisit(lead: Lead) {
  let at = unworked.has(String(lead.status || '').toLowerCase()) ? 0 : eventMillis(lead.dispositionedAt);
  for (const h of lead.dispositionHistory || []) if (!unworked.has(String(h.disposition).toLowerCase().replace(/\s+/g,'-'))) at = Math.max(at,eventMillis(h.timestamp));
  return at;
}
export const compareHouseVisits = (a: Lead, b: Lead) => latestVisit(b) - latestVisit(a) || Number(!!a.historicalTerritoryPin) - Number(!!b.historicalTerritoryPin) || a.id.localeCompare(b.id);
export function metersBetween(a: {lat?:number;lng?:number}, b: {lat?:number;lng?:number}) {
  if (![a.lat,a.lng,b.lat,b.lng].every(x => typeof x === 'number' && Number.isFinite(x))) return Infinity;
  const dy = (a.lat! - b.lat!) * 111195, dx = (a.lng! - b.lng!) * 111195 * Math.cos((a.lat! + b.lat!) * Math.PI / 360);
  return Math.hypot(dx,dy);
}
/** Address identity first; nearby coordinates only resolve postal-town aliases.
 * Never join different street numbers simply because their roofs are close. */
export function sameHouse(a: Lead, b: Lead) {
  if (a.homeowner?.id && a.homeowner.id === b.homeowner?.id) return true;
  const street = houseStreet(a.address);
  if (!street || street !== houseStreet(b.address)) return false;
  if (a.state && b.state && clean(a.state) !== clean(b.state)) return false;
  const townA = clean((a as Lead & {town?:string}).town || a.city), townB = clean((b as Lead & {town?:string}).town || b.city);
  return townA && townA === townB ? metersBetween(a,b) < 2000 || ![a.lat,a.lng,b.lat,b.lng].every(Number.isFinite) : metersBetween(a,b) < 75;
}
export function groupHouseLeads(leads: Lead[]) {
  const buckets = new Map<string, Lead[][]>(), homes = new Map<string, Lead[]>(), groups: Lead[][] = [];
  for (const lead of leads) {
    const street = houseStreet(lead.address), candidates = buckets.get(street) || [];
    let group = lead.homeowner?.id ? homes.get(lead.homeowner.id) : undefined;
    group ||= street ? candidates.find(g => sameHouse(g[0],lead)) : undefined;
    if (!group) { group=[]; groups.push(group); candidates.push(group); buckets.set(street,candidates); }
    group.push(lead);
    if (lead.homeowner?.id) homes.set(lead.homeowner.id,group);
  }
  const byLead = new Map<string, Lead[]>();
  for (const group of groups) { group.sort(compareHouseVisits); for (const l of group) byLead.set(l.id,group); }
  return { groups, byLead, pins: groups.map(g => g[0]) };
}
/** Display only. Never assign this aggregate to a lead or send it to Firestore. */
export function houseHistory(leads: Lead[]): LeadDispositionHistoryEntry[] {
  const entries = new Map<string, LeadDispositionHistoryEntry>();
  for (const lead of leads) {
    const history = lead.dispositionHistory || [];
    for (const h of history) {
      const at = eventMillis(h.timestamp);
      if (!at) continue;
      const key = `${at}:${h.userId || h.userName}:${h.disposition}`;
      if (!entries.has(key)) entries.set(key,{...h,timestamp:new Date(at)});
    }
    // Some legacy pins have a knock timestamp but no inline history.
    if (!history.length && latestVisit(lead) && !unworked.has(lead.status)) {
      const timestamp = new Date(eventMillis(lead.dispositionedAt));
      if (timestamp.getTime()) entries.set(`legacy:${lead.id}`,{disposition:lead.disposition || lead.status,timestamp,userId:'',userName:lead.historicalSetByName || 'Rep not recorded'});
    }
  }
  return [...entries.values()].sort((a,b) => eventMillis(b.timestamp)-eventMillis(a.timestamp));
}
