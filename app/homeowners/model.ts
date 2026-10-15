import { groupHouseLeads, houseStreet, compareHouseVisits, metersBetween, mergeLeadSnapshots } from "./houseIdentity";
import { scopedViews, inPinScope, type PinScope } from "@/app/mobile/_lib/pinScope";
import type { Lead } from "@/app/types";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import type { ViewportBounds } from "@/app/utils/mapViewport";
export const TTL = 30 * 86400000;
export const MIN_ZOOM = 15;
export const QUERY_LIMIT = 500;
export const MAX_VIEW_READS = 2000;
export const MAX_VIEW_QUERIES = 12;
const ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";
const VALID_HASH = new RegExp(`^[${ALPHABET}]{9}$`);
export const TILE_SIZE = 32 ** 4;
export type Homeowner = {
  id: string;
  address: string;
  addressNorm: string;
  municipality: string;
  state: string;
  ownerName: string;
  occupancyStatus: string;
  suspectedRenter?: boolean;
  mailingCity: string;
  mailingZip: string;
  propertyType: string;
  marketValue?: number;
  lat: number;
  lng: number;
  geohash: string;
  geohash5: string;
};
export type Range = { lo: number; hi: number }; // Half-open integer ranges of 9-character hashes.
export type Receipt = Range & { at: number; complete: boolean; zoom: number; progressive?: boolean };
export type HomeTile = {
  tile: string;
  docs: Record<string, Homeowner>;
  receipts: Receipt[];
  touched: number;
};
export type View = ViewportBounds & { zoom: number; polygons?: PinScope };
const str = (x: unknown, max = 200) =>
  typeof x === "string" ? x.slice(0, max) : "";
export function parseHomeowner(
  id: string,
  x: Record<string, unknown>,
): Homeowner | null {
  if (
    typeof x.lat !== "number" ||
    typeof x.lng !== "number" ||
    !Number.isFinite(x.lat) ||
    !Number.isFinite(x.lng) ||
    Math.abs(x.lat) > 90 ||
    Math.abs(x.lng) > 180 ||
    !VALID_HASH.test(String(x.geohash))
  )
    return null;
  const geohash = String(x.geohash);
  return {
    id,
    address: str(x.address),
    addressNorm: str(x.addressNorm),
    municipality: str(x.municipality),
    state: str(x.state, 2),
    ownerName: str(x.ownerName),
    occupancyStatus: str(x.occupancyStatus),
    ...(typeof x.suspectedRenter === "boolean"
      ? { suspectedRenter: x.suspectedRenter }
      : {}),
    mailingCity: str(x.mailingCity),
    mailingZip: str(x.mailingZip, 15),
    propertyType: str(x.propertyType),
    ...(typeof x.marketValue === "number" &&
    Number.isFinite(x.marketValue) &&
    x.marketValue >= 0
      ? { marketValue: x.marketValue }
      : {}),
    lat: x.lat,
    lng: x.lng,
    geohash,
    geohash5: geohash.slice(0, 5),
  };
}
export const suspectedRenter = (
  h: Pick<Homeowner, "suspectedRenter" | "occupancyStatus">,
) =>
  typeof h.suspectedRenter === "boolean"
    ? h.suspectedRenter
    : h.occupancyStatus === "Absentee / Possible Renter";
export const occupancyLabel = (h: Homeowner) =>
  suspectedRenter(h) ? "Suspected renter" : "Owner";
export function hashNumber(s: string) {
  let n = 0;
  for (let i = 0; i < 9; i++) {
    const ch = s[i],
      v = ch === undefined ? 0 : ALPHABET.indexOf(ch);
    if (v < 0) throw Error("Invalid geohash");
    n = n * 32 + v;
  }
  return n;
}
export function numberHash(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 32 ** 9)
    throw Error("Invalid geohash number");
  let s = "";
  for (let i = 0; i < 9; i++) {
    s = ALPHABET[n % 32] + s;
    n = Math.floor(n / 32);
  }
  return s;
}
function upperHash(s: string) {
  const i = s.indexOf("~");
  return i < 0
    ? hashNumber(s) + (s.length === 9 ? 1 : 0)
    : hashNumber(s.slice(0, i)) + 32 ** (9 - i);
}
export function unionRanges(ranges: Range[]): Range[] {
  const result: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.lo - b.lo)) {
    if (r.hi <= r.lo) continue;
    const p = result[result.length - 1];
    if (p && r.lo <= p.hi) p.hi = Math.max(p.hi, r.hi);
    else result.push({ ...r });
  }
  return result;
}
export function subtractRanges(wanted: Range[], covered: Range[]): Range[] {
  let result = unionRanges(wanted);
  for (const c of unionRanges(covered)) {
    result = result.flatMap((r) =>
      c.hi <= r.lo || c.lo >= r.hi
        ? [r]
        : [
            ...(r.lo < c.lo ? [{ lo: r.lo, hi: c.lo }] : []),
            ...(r.hi > c.hi ? [{ lo: c.hi, hi: r.hi }] : []),
          ],
    );
  }
  return result;
}
export function viewCircle(v: View) {
  const center: [number, number] = [
    (v.north + v.south) / 2,
    (v.east + v.west) / 2,
  ];
  const radius = distanceBetween(center, [v.north, v.east]) * 1000;
  return { center, radius };
}
/** Always bounded to a street-level circle and clipped at geohash5 tile boundaries. */
export function planRanges(v: View): Map<string, Range[]> {
  const output = new Map<string, Range[]>();
  if (v.polygons) {
    for (const clipped of scopedViews(v, v.polygons)) for (const [tile, ranges] of planRanges(clipped))
      output.set(tile, unionRanges([...(output.get(tile) || []), ...ranges]));
    return output;
  }
  if (
    v.zoom < MIN_ZOOM ||
    ![v.south, v.north, v.west, v.east].every(Number.isFinite) ||
    v.south >= v.north ||
    v.west >= v.east ||
    v.south < -90 ||
    v.north > 90 ||
    v.west < -180 ||
    v.east > 180
  )
    return output;
  const { center, radius } = viewCircle(v);
  if (radius <= 0 || radius > 2500) return output; // Large desktop views must zoom closer.
  for (const r of unionRanges(
    geohashQueryBounds(center, radius).map(([a, b]) => ({
      lo: hashNumber(a),
      hi: upperHash(b),
    })),
  )) {
    for (let lo = r.lo; lo < r.hi; ) {
      const end = Math.min(r.hi, (Math.floor(lo / TILE_SIZE) + 1) * TILE_SIZE),
        tile = numberHash(lo).slice(0, 5);
      output.set(tile, [...(output.get(tile) || []), { lo, hi: end }]);
      lo = end;
      if (output.size > 32) return new Map();
    }
  }
  return output;
}
export function missingRanges(
  tile: HomeTile,
  wanted: Range[],
  zoom: number,
  now = Date.now(),
) {
  const fresh = tile.receipts.filter((r) => now - r.at < TTL);
  const complete = fresh.filter((r) => r.complete);
  const missing = subtractRanges(wanted, complete);
  const blocked = fresh.filter((r) => !r.complete);
  let dense = false;
  const result = missing.flatMap((r) => {
    const skip = blocked.filter(
      (b) => !((zoom > b.zoom || b.progressive) && r.hi - r.lo < b.hi - b.lo),
    );
    if (skip.some((b) => b.lo < r.hi && b.hi > r.lo)) dense = true;
    return subtractRanges([r], skip);
  });
  return { ranges: result, dense };
}
export function tileComplete(tile: HomeTile, now = Date.now()) {
  const lo = hashNumber(tile.tile);
  return (
    subtractRanges(
      [{ lo, hi: lo + TILE_SIZE }],
      tile.receipts.filter((r) => r.complete && now - r.at < TTL),
    ).length === 0
  );
}
export function applyRead(
  tile: HomeTile,
  range: Range,
  docs: Homeowner[],
  rawCount: number,
  zoom: number,
  now = Date.now(),
): HomeTile {
  const merged = { ...tile.docs };
  // A successful complete range refresh also removes records deleted from that range.
  if (rawCount < QUERY_LIMIT)
    for (const [id, h] of Object.entries(merged)) {
      const n = hashNumber(h.geohash);
      if (n >= range.lo && n < range.hi) delete merged[id];
    }
  for (const h of docs) if (h.geohash5 === tile.tile) merged[h.id] = h;
  let receipts = tile.receipts.filter(
    (r) => now - r.at < TTL && !(r.lo === range.lo && r.hi === range.hi),
  );
  // Don't create false coverage by merging timestamps. Oldest receipt wins.
  const cutoff = docs.length ? Math.max(...docs.map(h => hashNumber(h.geohash))) : range.lo;
  if (rawCount >= QUERY_LIMIT && cutoff > range.lo && cutoff < range.hi) {
    // Do not mark the final hash complete: several records can share it.
    receipts.push({lo:range.lo,hi:cutoff,at:now,complete:true,zoom,progressive:true});
    receipts.push({...range,at:now,complete:false,zoom,progressive:true});
  } else receipts.push({ ...range, at: now, complete: rawCount < QUERY_LIMIT, zoom, progressive:rawCount < QUERY_LIMIT });
  if (receipts.length > 300) receipts = receipts.slice(-300);
  return { ...tile, docs: merged, receipts, touched: now };
}
export function inView(
  h: { lat: number; lng: number },
  v: View,
  paddingMeters = 0,
) {
  const p = paddingMeters / 111000,
    pl = p / Math.max(0.1, Math.cos((h.lat * Math.PI) / 180));
  return (
    h.lat >= v.south - p &&
    h.lat <= v.north + p &&
    h.lng >= v.west - pl &&
    h.lng <= v.east + pl
  );
}
const suffixes: Record<string, string> = {
  STREET: "ST",
  ROAD: "RD",
  AVENUE: "AVE",
  DRIVE: "DR",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  TERRACE: "TER",
  PARKWAY: "PKWY",
  HIGHWAY: "HWY",
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
};
export function normalized(value: unknown, street = false) {
  let s = String(value || "").toUpperCase();
  if (street)
    s = s.replace(/(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\b|#).*$/, "");
  s = s
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return street
    ? s
        .split(" ")
        .map((w) => suffixes[w] || w)
        .join(" ")
    : s;
}
const addressKey = (address: unknown, town: unknown) =>
  `${houseStreet(address)}|${normalized(town)}`;
export type HouseIndex = {
  addresses: Map<string, Lead[]>;
  streets: Map<string, Lead[]>;
  cells: Map<string, Lead[]>;
  leads: Lead[];
  grouped: ReturnType<typeof groupHouseLeads>;
};
const cell = (lat: number, lng: number) =>
  `${Math.floor(lat / 0.0005)}:${Math.floor(lng / 0.0005)}`;
export function buildHouseIndex(leads: Lead[]): HouseIndex {
  leads = mergeLeadSnapshots(leads);
  const addresses = new Map<string, Lead[]>(), streets = new Map<string, Lead[]>(), cells = new Map<string, Lead[]>();
  for (const l of leads) {
    const street = houseStreet(l.address), key = addressKey(l.address,(l as Lead & {town?:string}).town || l.city);
    if (street) {
      for (const [map,k] of [[addresses,key],[streets,street]] as const) {
        const group=map.get(k) || []; group.push(l); map.set(k,group);
      }
    }
    if (typeof l.lat === 'number' && typeof l.lng === 'number' && Number.isFinite(l.lat) && Number.isFinite(l.lng)) {
      const k=cell(l.lat,l.lng), group=cells.get(k) || []; group.push(l); cells.set(k,group);
    }
  }
  for (const group of addresses.values()) group.sort(compareHouseVisits);
  return {addresses,streets,cells,leads,grouped:groupHouseLeads(leads)};
}
export function mergeHomeowners(homes: Homeowner[], index: HouseIndex) {
  const gray: Homeowner[] = [], byLead = new Map<string, Homeowner>(), hiddenLeadIds = new Set<string>();
  const groupedByLead = new Map(index.grouped.byLead);
  // Deduplication is independent of whether homeowner pins are enabled or loaded.
  for (const group of index.grouped.groups) for (const l of group.slice(1)) hiddenLeadIds.add(l.id);
  // Duplicate parcel imports must not paint two homeowner dots on one house.
  const homeById = new Map(homes.map(h=>[h.id,h]));
  const homeGroups = groupHouseLeads(homes.map(h=>({id:h.id,address:h.addressNorm||h.address,city:h.municipality,state:h.state,lat:h.lat,lng:h.lng,status:'unclaimed'} as Lead)));
  for (const house of homeGroups.groups) {
    const h=homeById.get(house[0].id)!;
    const street=houseStreet(h.addressNorm || h.address);
    const sameState=(l:Lead) => !l.state || !h.state || normalized(l.state)===normalized(h.state);
    let matches=(index.addresses.get(addressKey(street,h.municipality)) || []).filter(l=>sameState(l) && (metersBetween(h,l)<2000 || ![l.lat,l.lng].every(Number.isFinite)));
    if (!matches.length) matches=(index.streets.get(street) || []).filter(l=>sameState(l) && metersBetween(h,l)<75).sort(compareHouseVisits);
    // Only address-less legacy pins may use a tight, unambiguous proximity match.
    if (!matches.length) {
      const a=Math.floor(h.lat / .0005), b=Math.floor(h.lng / .0005), nearby:Lead[]=[];
      for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++)
        for(const l of index.cells.get(`${a+x}:${b+y}`) || []) if(!houseStreet(l.address) && metersBetween(h,l)<12) nearby.push(l);
      if(nearby.length===1) matches=nearby;
    }
    const match=matches[0];
    if (!match) { gray.push(h); continue; }
    const group=mergeLeadSnapshots(...matches.map(l=>groupedByLead.get(l.id)||[l])).sort(compareHouseVisits);
    hiddenLeadIds.delete(group[0].id);
    for(const l of group.slice(1))hiddenLeadIds.add(l.id);
    for(const l of group) {
      groupedByLead.set(l.id,group);
      const previous=byLead.get(l.id);
      if(!previous || metersBetween(h,l)<metersBetween(previous,l)) byLead.set(l.id,h);
    }
  }
  return {gray,byLead,hiddenLeadIds,groupedByLead};
}
