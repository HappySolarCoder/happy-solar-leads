import type { Lead, LeadDispositionHistoryEntry } from '@/app/types';
import { DEFAULT_DISPOSITIONS, type Disposition } from '@/app/types/disposition';

const aliases: Record<string, string> = { STREET:'ST', ROAD:'RD', AVENUE:'AVE', DRIVE:'DR', LANE:'LN', COURT:'CT', PLACE:'PL', BOULEVARD:'BLVD', CIRCLE:'CIR', TERRACE:'TER', PARKWAY:'PKWY', HIGHWAY:'HWY', NORTH:'N', SOUTH:'S', EAST:'E', WEST:'W' };
const clean = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9\s]/g,' ').trim().replace(/\s+/g,' ');
export function houseStreet(value: unknown) {
  // Geocoders sometimes put the full postal address in the street field.
  return clean(String(value || '').split(',')[0].replace(/(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\b|#).*$/i,''))
    .split(' ').map(w => aliases[w] || w).join(' ');
}
export function eventMillis(value: unknown): number {
  if (!value) return 0;
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number };
  const seconds = v.seconds ?? v._seconds;
  const n = typeof v.toMillis === 'function' ? v.toMillis() : typeof v.toDate === 'function' ? v.toDate().getTime() : typeof seconds === 'number'
    ? seconds * 1000 + (v.nanoseconds ?? v._nanoseconds ?? 0) / 1e6 : new Date(value as string).getTime();
  return Number.isFinite(n) ? n : 0;
}
const unworked = new Set(['','assigned','unassigned','unclaimed','claimed','new','not-knocked','available','my-targets']);
const dispositionKey = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g,'-');
export function latestVisit(lead: Lead) {
  let at = unworked.has(dispositionKey(lead.status)) ? 0 : eventMillis(lead.dispositionedAt);
  for (const h of lead.dispositionHistory || []) if (!unworked.has(dispositionKey(h.disposition))) at = Math.max(at,eventMillis(h.timestamp));
  return at;
}
/** Display projection only: never persist or use this object as a write patch.
 * Canonical status wins a timestamp tie; an explicitly newer history event wins
 * over a stale status. Resolve existing configured IDs, never invent new ones. */
export function latestKnockDisplay(lead: Lead, dispositions: Disposition[] = DEFAULT_DISPOSITIONS): Lead {
  const history = (lead.dispositionHistory || []).filter(h => !unworked.has(dispositionKey(h.disposition)));
  const last = history.reduce<LeadDispositionHistoryEntry | undefined>((best,h) => !best || eventMillis(h.timestamp) > eventMillis(best.timestamp) ? h : best, undefined);
  if (!last || !eventMillis(last.timestamp)) return lead;
  if (!unworked.has(dispositionKey(lead.status)) && eventMillis(last.timestamp) <= eventMillis(lead.dispositionedAt)) return lead;
  const match = [...dispositions, ...DEFAULT_DISPOSITIONS].find(d => dispositionKey(d.id) === dispositionKey(last.disposition) || dispositionKey(d.name) === dispositionKey(last.disposition));
  if (!match) return lead;
  return {...lead, status:match.id, disposition:match.name, dispositionedAt:new Date(eventMillis(last.timestamp))};
}
/** Reconcile the same document from personal, viewport and saved-knock caches.
 * Arrival order is not event order. Equal versions prefer a full document. */
export function mergeLeadSnapshots(...sources: ReadonlyArray<ReadonlyArray<Lead>>): Lead[] {
  const records = new Map<string, Lead>();
  for (const source of sources) for (const lead of source) {
    const previous = records.get(lead.id);
    const delta = previous ? latestVisit(lead) - latestVisit(previous) : 1;
    const summary = (l:Lead) => !!(l as Lead & {mobileSummary?:boolean}).mobileSummary;
    if (!previous || delta > 0 || (delta === 0 && !(summary(lead) && !summary(previous)))) records.set(lead.id, lead);
  }
  return [...records.values()];
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
  const rows = mergeLeadSnapshots(leads);
  const parents = rows.map((_,i) => i), buckets = new Map<string,number[]>(), homes = new Map<string,number>();
  const root = (i:number):number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  const join = (a:number,b:number) => { parents[root(a)] = root(b); };
  for (const [i,lead] of rows.entries()) {
    const street = houseStreet(lead.address), candidates = buckets.get(street) || [];
    // Check every matching member, not just the first record returned by a page.
    if (street) for (const other of candidates) if (sameHouse(rows[other],lead)) join(i,other);
    if (lead.homeowner?.id) {
      const other = homes.get(lead.homeowner.id);
      if (other !== undefined) join(i,other);
      homes.set(lead.homeowner.id,i);
    }
    candidates.push(i); buckets.set(street,candidates);
  }
  const connected = new Map<number,Lead[]>();
  for (const [i,lead] of rows.entries()) { const key=root(i), group=connected.get(key)||[]; group.push(lead); connected.set(key,group); }
  const groups = [...connected.values()];
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
