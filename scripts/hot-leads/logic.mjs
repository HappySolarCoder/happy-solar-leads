/**
 * Pure hot-lead import helpers. The CLI defaults to a dry run.
 * houseIdentity.ts is not in this repo, so houseStreet / sameHouse live here.
 * Street suffixes match app/homeowners/model.ts normalizeStreet.
 *
 * Geocode cache values and the review file never store an address.
 * Re-imports write only ghl, import, updatedAt, and doNotCall.
 * Do Not Contact rows are imported with doNotCall: true. Lost rows and rows
 * with no address are still skipped.
 */
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Papa = require('papaparse');
const { geohashForLocation, geohashQueryBounds, distanceBetween } = require('geofire-common');
const { Timestamp } = require('firebase-admin/firestore');

const STREET_SUFFIXES = {
  street: 'st', st: 'st', str: 'st',
  avenue: 'ave', ave: 'ave', av: 'ave',
  road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr',
  boulevard: 'blvd', blvd: 'blvd',
  lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl',
  terrace: 'ter', ter: 'ter',
  circle: 'cir', cir: 'cir',
  highway: 'hwy', hwy: 'hwy',
  parkway: 'pkwy', pkwy: 'pkwy',
  trail: 'trl', trl: 'trl',
};

const SUFFIX_WORDS = new Set(Object.keys(STREET_SUFFIXES));

export const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
export const CENSUS_BENCHMARK = 'Public_AR_Current';
export const CENSUS_MIN_INTERVAL_MS = 500;
export const CENSUS_BATCH_SIZE = 100;
export const HOMEOWNER_RADIUS_M = 50;
export const HOMEOWNER_QUERY_LIMIT = 8;
export const HOMEOWNER_QUERY_CAP = 4;
export const LINK_DISTANCE_M = 75;
export const HOT_LIST_PAGE = 200;
export const HOT_LIST_PAGES = 20;
export const REIMPORT_KEYS = ['ghl', 'import', 'updatedAt', 'doNotCall'];

const OPP_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export function normalizeStreet(value) {
  if (typeof value !== 'string') return '';
  const place = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!place) return '';
  const parts = place.split(' ');
  const last = parts[parts.length - 1];
  const canonical = STREET_SUFFIXES[last];
  if (canonical) parts[parts.length - 1] = canonical;
  return parts.join(' ');
}

export function parseAddressLine(line) {
  let text = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  text = text.replace(/,?\s+usa$/i, '').trim();
  let zip = '';
  const zipMatch = text.match(/^(.*\S)\s+(\d{5})$/);
  if (zipMatch) {
    text = zipMatch[1].trim();
    zip = zipMatch[2];
  }
  const stateMatch = text.match(/^(.*\S)\s+([A-Za-z]{2})$/);
  if (!stateMatch) return null;
  const state = stateMatch[2].toUpperCase();
  const left = stateMatch[1].trim();
  const numMatch = left.match(/^(\d+)\s+(\S.*)$/);
  if (!numMatch) return null;
  const houseNumber = numMatch[1];
  const rest = numMatch[2].split(' ');
  let streetEnd = -1;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i].toLowerCase().replace(/\./g, '');
    if (SUFFIX_WORDS.has(token)) streetEnd = i;
  }
  let streetTokens;
  let cityTokens;
  if (streetEnd >= 0 && streetEnd < rest.length - 1) {
    streetTokens = rest.slice(0, streetEnd + 1);
    cityTokens = rest.slice(streetEnd + 1);
  } else if (rest.length >= 2) {
    cityTokens = [rest[rest.length - 1]];
    streetTokens = rest.slice(0, -1);
  } else {
    streetTokens = rest;
    cityTokens = [];
  }
  const addressNorm = normalizeStreet(`${houseNumber} ${streetTokens.join(' ')}`);
  if (!addressNorm) return null;
  return {
    city: cityTokens.join(' '),
    state,
    zip,
    addressNorm,
  };
}

export function houseStreet(line) {
  return parseAddressLine(line)?.addressNorm ?? '';
}

export function sameHouse(a, b) {
  if (!a?.addressNorm || a.addressNorm !== b?.addressNorm) return false;
  const stateA = String(a.state || '').trim().toUpperCase();
  const stateB = String(b.state || '').trim().toUpperCase();
  if (!stateA || stateA !== stateB) return false;
  const zipA = String(a.zip || '').trim();
  const zipB = String(b.zip || '').trim();
  if (zipA && zipB && zipA !== zipB) return false;
  return true;
}

export function houseOfRecord(data) {
  const record = data && typeof data === 'object' ? data : {};
  const state = String(record.state || '').trim().toUpperCase();
  const zip = String(record.zip || record.postalCode || '').trim();
  const city = String(record.city || record.municipality || '').trim();
  const raw = String(record.address || record.street || '').trim();
  const parsed = parseAddressLine([raw, city, state, zip].filter(Boolean).join(' '));
  if (parsed) return parsed;
  return { addressNorm: normalizeStreet(raw), state, zip, city };
}

function cell(value) {
  const text = value == null ? '' : String(value).trim();
  return text;
}

/** DNC means do not call. The row is still a hot lead and can be knocked. */
export function isDoNotContact(stage) {
  const value = String(stage ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return value === 'dead/do not contact'
    || value === 'do not contact'
    || value === 'dnc'
    || value === 'do not call';
}

export function classifyRows(rows, options = {}) {
  const skipped = { noAddress: 0, lost: 0, duplicate: 0, badId: 0 };
  const seen = new Set();
  const kept = [];
  let dncImported = 0;
  for (const row of rows) {
    const opportunityId = cell(row['Opportunity ID']);
    if (!OPP_ID_RE.test(opportunityId)) {
      skipped.badId += 1;
      continue;
    }
    if (seen.has(opportunityId)) {
      skipped.duplicate += 1;
      continue;
    }
    seen.add(opportunityId);
    const stage = cell(row.stage);
    const status = cell(row.status);
    if (!options.includeLost && status === 'lost') {
      skipped.lost += 1;
      continue;
    }
    const address = cell(row.Address) || cell(row['Contact Address']);
    if (!address) {
      skipped.noAddress += 1;
      continue;
    }
    const parsed = parseAddressLine(address);
    if (!parsed) {
      skipped.noAddress += 1;
      continue;
    }
    const doNotCall = isDoNotContact(stage);
    if (doNotCall) dncImported += 1;
    kept.push({
      doNotCall,
      opportunityId,
      contactId: cell(row['Contact ID']),
      name: cell(row['Contact Name']) || [cell(row['First Name']), cell(row['Last Name'])].filter(Boolean).join(' '),
      phone: cell(row.phone),
      email: cell(row.email),
      address,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
      addressNorm: parsed.addressNorm,
      pipeline: cell(row.pipeline),
      pipelineId: cell(row['Pipeline ID']),
      stage,
      pipelineStageId: cell(row['Pipeline Stage ID']),
      status,
      source: cell(row.source),
      createdOn: cell(row['Created on']),
      updatedOn: cell(row['Updated on']),
    });
  }
  return { skipped, kept, dncImported };
}

export function rowHash(row) {
  return createHash('sha256').update(JSON.stringify({
    opportunityId: row.opportunityId,
    contactId: row.contactId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    stage: row.stage,
    status: row.status,
    source: row.source,
    pipelineId: row.pipelineId,
    pipelineStageId: row.pipelineStageId,
    createdOn: row.createdOn,
    updatedOn: row.updatedOn,
  })).digest('hex');
}

export function groupHouses(kept) {
  const groups = new Map();
  let withinSheetMerges = 0;
  for (const row of kept) {
    const key = `${row.addressNorm}|${row.state}`;
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(row);
      withinSheetMerges += 1;
    } else groups.set(key, { members: [row] });
  }
  const houses = [];
  for (const group of groups.values()) {
    const members = group.members.slice().sort((a, b) => (a.opportunityId < b.opportunityId ? -1 : 1));
    const canonical = members[0];
    const latest = members.slice().sort((a, b) => String(a.updatedOn).localeCompare(String(b.updatedOn))).at(-1) ?? canonical;
    const zip = members.map((row) => row.zip).find(Boolean) || '';
    const city = members.map((row) => row.city).find(Boolean) || '';
    houses.push({
      id: `ghl_${canonical.opportunityId}`,
      opportunityId: canonical.opportunityId,
      address: canonical.address,
      city,
      state: canonical.state,
      zip,
      addressNorm: canonical.addressNorm,
      contacts: members.map((row) => {
        const contact = {};
        if (row.name) contact.name = row.name;
        if (row.phone) contact.phone = row.phone;
        if (row.email) contact.email = row.email;
        return contact;
      }),
      ghl: {
        opportunityId: latest.opportunityId,
        ...(latest.contactId ? { contactId: latest.contactId } : {}),
        ...(latest.pipelineId ? { pipelineId: latest.pipelineId } : {}),
        ...(latest.pipelineStageId ? { pipelineStageId: latest.pipelineStageId } : {}),
        ...(latest.stage ? { stage: latest.stage } : {}),
        ...(latest.source ? { source: latest.source } : {}),
        ...(latest.createdOn ? { createdOn: latest.createdOn } : {}),
        ...(latest.updatedOn ? { updatedOn: latest.updatedOn } : {}),
      },
      rowHash: createHash('sha256').update(members.map((row) => rowHash(row)).sort().join('\n')).digest('hex'),
      doNotCall: members.some((row) => row.doNotCall === true),
    });
  }
  return { houses, withinSheetMerges };
}

export function addressCacheKey(house) {
  return createHash('sha256').update([
    house.addressNorm,
    house.city,
    house.state,
    house.zip,
  ].join('|').toLowerCase()).digest('hex');
}

export function serializeCache(cache) {
  const out = {};
  for (const [key, value] of cache.entries()) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('cache_key');
    const quality = value?.quality === 'Exact' || value?.quality === 'Non_Exact' || value?.quality === 'No_Match'
      ? value.quality
      : 'Match';
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (quality === 'No_Match') out[key] = { quality };
    else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('cache_point');
      out[key] = { lat, lng, quality };
    }
  }
  return JSON.stringify(out);
}

export function reviewCsv(rows) {
  const lines = ['opportunityId,reason'];
  for (const row of rows) {
    if (!OPP_ID_RE.test(row.opportunityId)) continue;
    if (row.reason !== 'geocode_unmatched') continue;
    lines.push(`${row.opportunityId},geocode_unmatched`);
  }
  return `${lines.join('\n')}\n`;
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((part) => part !== ''));
}

export function parseCensusBatch(text) {
  return parseCsv(text).map((row) => {
    const status = row[2] || '';
    const qualityToken = row[3] || '';
    let lat = null;
    let lng = null;
    if (status === 'Match' && row[5]) {
      const [lon, latText] = String(row[5]).split(',');
      lng = Number(lon);
      lat = Number(latText);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        lat = null;
        lng = null;
      }
    }
    const matched = status === 'Match' && lat != null && lng != null;
    return {
      id: row[0],
      matched,
      lat,
      lng,
      quality: matched ? (qualityToken === 'Non_Exact' ? 'Non_Exact' : 'Exact') : 'No_Match',
    };
  });
}

export function censusRequestCsv(houses) {
  return houses.map((house, index) => [
    String(index),
    house.addressNorm,
    house.city,
    house.state,
    house.zip,
  ].map(csvEscape).join(',')).join('\n');
}

export function homeownerReadPlan(lat, lng) {
  const bounds = geohashQueryBounds([lat, lng], HOMEOWNER_RADIUS_M).slice(0, HOMEOWNER_QUERY_CAP);
  return {
    radiusM: HOMEOWNER_RADIUS_M,
    queries: bounds.map(([start, end]) => ({
      orderBy: 'geohash',
      start,
      end,
      limit: HOMEOWNER_QUERY_LIMIT,
    })),
  };
}

/** Same bounded geohash fan-out as a homeowner lookup. A lat band of limit 20 crosses every longitude. */
export function leadReadPlan(lat, lng) {
  return homeownerReadPlan(lat, lng);
}

export function toTimestamp(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'object' && typeof value.toMillis === 'function' && typeof value.toDate === 'function') {
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Timestamp.fromDate(date);
}

function stampedGhl(ghl, stamp) {
  const out = { ...(ghl || {}) };
  if (out.createdOn) {
    const stamped = stamp(out.createdOn);
    if (stamped) out.createdOn = stamped;
    else delete out.createdOn;
  }
  if (out.updatedOn) {
    const stamped = stamp(out.updatedOn);
    if (stamped) out.updatedOn = stamped;
    else delete out.updatedOn;
  }
  return out;
}

function nearEnough(lat, lng, doc) {
  const data = doc?.data && typeof doc.data === 'object' ? doc.data : doc;
  if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number') return true;
  return distanceBetween([lat, lng], [data.lat, data.lng]) * 1000 <= LINK_DISTANCE_M;
}

export function pickLink(house, docs) {
  for (const doc of docs) {
    const data = doc.data && typeof doc.data === 'object' ? doc.data : doc;
    if (!nearEnough(house.lat, house.lng, doc)) continue;
    if (sameHouse(house, houseOfRecord(data))) return String(doc.id);
  }
  return null;
}

export function reimportPatch(existing, next, stamp = toTimestamp) {
  const prev = existing?.import && typeof existing.import === 'object' ? existing.import : {};
  const history = Array.isArray(prev.history) ? prev.history.slice(-19) : [];
  history.push({ batchId: next.batchId, at: stamp(next.at), rowHash: next.rowHash });
  return {
    ghl: stampedGhl(next.ghl, stamp),
    import: {
      batchId: next.batchId,
      importedAt: stamp(next.at),
      rowHash: next.rowHash,
      history,
    },
    updatedAt: stamp(next.at),
    doNotCall: next.doNotCall === true,
  };
}

export function createDoc(house, at, batchId, stamp = toTimestamp) {
  return {
    address: house.address,
    ...(house.city ? { city: house.city } : {}),
    state: house.state,
    ...(house.zip ? { zip: house.zip } : {}),
    addressNorm: house.addressNorm,
    lat: house.lat,
    lng: house.lng,
    geohash: house.geohash,
    geo: house.geo,
    homeownerId: house.homeownerId ?? null,
    linkedLeadId: house.linkedLeadId ?? null,
    contacts: house.contacts,
    ghl: stampedGhl(house.ghl, stamp),
    import: {
      batchId,
      importedAt: stamp(at),
      rowHash: house.rowHash,
      history: [{ batchId, at: stamp(at), rowHash: house.rowHash }],
    },
    hotStatus: 'active',
    updatedAt: stamp(at),
    ...(house.doNotCall ? { doNotCall: true } : {}),
  };
}

export function retirePatch(at, stamp = toTimestamp) {
  return { hotStatus: 'retired', updatedAt: stamp(at) };
}

function cacheHit(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.quality === 'No_Match') return { matched: false, quality: 'No_Match' };
  if (typeof value.lat === 'number' && typeof value.lng === 'number') {
    return { matched: true, lat: value.lat, lng: value.lng, quality: value.quality || 'Exact' };
  }
  return null;
}

export function isCensusCsv(text) {
  const body = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!body || body.startsWith('<') || /<html/i.test(body) || /request rejected/i.test(body)) return false;
  return body.split(/\r?\n/, 1)[0].includes(',');
}

export async function geocodeHouses(houses, deps) {
  const cache = deps.cache;
  const pending = [];
  for (const house of houses) {
    const key = addressCacheKey(house);
    house.cacheKey = key;
    const hit = cacheHit(cache.get(key));
    if (hit) {
      house.geocode = hit;
      continue;
    }
    pending.push(house);
  }
  const batchSize = deps.batchSize || CENSUS_BATCH_SIZE;
  let requests = 0;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const chunk = pending.slice(offset, offset + batchSize);
    const csv = censusRequestCsv(chunk);
    let parsed = null;
    let failed = null;
    for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
      if (requests > 0 || attempt > 0) await deps.throttle();
      requests += 1;
      try {
        const text = await deps.fetchBatch(csv);
        if (!isCensusCsv(text)) throw new Error('geocode_not_csv');
        const rows = parseCensusBatch(text);
        if (!rows.length) throw new Error('geocode_empty');
        parsed = rows;
      } catch (error) {
        failed = error;
        parsed = null;
      }
    }
    if (!parsed) throw failed || new Error('geocode_failed');
    chunk.forEach((house, index) => {
      const row = parsed.find((item) => item.id === String(index)) || { matched: false, quality: 'No_Match' };
      const stored = row.matched
        ? { lat: row.lat, lng: row.lng, quality: row.quality }
        : { quality: 'No_Match' };
      cache.set(house.cacheKey, stored);
      house.geocode = row.matched
        ? { matched: true, lat: row.lat, lng: row.lng, quality: row.quality }
        : { matched: false, quality: 'No_Match' };
    });
  }
  return { requests };
}

function applyPoint(house, source) {
  house.lat = source.lat;
  house.lng = source.lng;
  house.geohash = geohashForLocation([source.lat, source.lng]);
  house.geo = { source: source.source, ...(source.quality ? { quality: source.quality } : {}) };
}

export async function linkHouse(house, db) {
  house.homeownerId = null;
  house.linkedLeadId = null;
  if (!db) return { homeownerReads: 0, leadReads: 0 };
  const ownerPlan = homeownerReadPlan(house.lat, house.lng);
  const owners = await db.homeownersNear(ownerPlan);
  const ownerId = pickLink(house, owners);
  let homeownerReads = ownerPlan.queries.length;
  if (ownerId) {
    const owner = owners.find((doc) => doc.id === ownerId);
    const data = owner?.data || {};
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      applyPoint(house, { lat: data.lat, lng: data.lng, source: 'homeowner', quality: house.geocode?.quality });
    }
    house.homeownerId = ownerId;
  }
  const leadPlan = leadReadPlan(house.lat, house.lng);
  if (
    !Array.isArray(leadPlan.queries)
    || leadPlan.queries.length > HOMEOWNER_QUERY_CAP
    || leadPlan.queries.some((query) => query.orderBy !== 'geohash' || query.limit > HOMEOWNER_QUERY_LIMIT)
  ) throw new Error('lead_read_unbounded');
  const leads = await db.leadsNear(leadPlan);
  house.linkedLeadId = pickLink(house, leads);
  return { homeownerReads, leadReads: 1 };
}

export function emptyReport(extra = {}) {
  return {
    rowsRead: 0,
    skipped: { noAddress: 0, lost: 0, duplicate: 0, badId: 0 },
    dncImported: 0,
    houses: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    retired: 0,
    geocodeMatched: 0,
    geocodeUnmatched: 0,
    homeownerLinks: 0,
    existingLeadLinks: 0,
    withinSheetMerges: 0,
    writes: 0,
    dryRun: true,
    ...extra,
  };
}

export async function runImport(input) {
  const commit = input.commit === true;
  const confirm = input.confirm === 'yes';
  if (commit && !confirm) {
    return { ok: false, code: 2, writes: 0, output: { error: 'confirm_required', writes: 0 } };
  }
  const rows = input.rows || [];
  const stamp = input.stamp || toTimestamp;
  const classified = classifyRows(rows, input);
  const grouped = groupHouses(classified.kept);
  const cache = input.cache || new Map();
  if (grouped.houses.length) {
    await geocodeHouses(grouped.houses, {
      cache,
      batchSize: input.batchSize,
      throttle: input.throttle || (async () => {}),
      fetchBatch: input.fetchBatch,
    });
  }
  const review = [];
  const batchId = input.batchId || 'batch';
  const at = input.at || new Date().toISOString();
  let geocodeMatched = 0;
  let geocodeUnmatched = 0;
  let homeownerLinks = 0;
  let existingLeadLinks = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let writes = 0;
  const plannedIds = new Set();
  for (const house of grouped.houses) {
    if (!house.geocode?.matched) {
      geocodeUnmatched += 1;
      review.push({ opportunityId: house.opportunityId, reason: 'geocode_unmatched' });
      continue;
    }
    geocodeMatched += 1;
    applyPoint(house, {
      lat: house.geocode.lat,
      lng: house.geocode.lng,
      source: 'census',
      quality: house.geocode.quality,
    });
    if (input.db) {
      const links = await linkHouse(house, input.db);
      if (house.homeownerId) homeownerLinks += 1;
      if (house.linkedLeadId) existingLeadLinks += 1;
      if (links.leadReads !== 1) throw new Error('lead_read');
    }
    plannedIds.add(house.id);
    const existing = input.db ? await input.db.get(house.id) : null;
    if (existing && existing.import?.rowHash === house.rowHash) {
      unchanged += 1;
      continue;
    }
    if (existing) {
      updated += 1;
      const patch = reimportPatch(existing, {
        ghl: house.ghl,
        batchId,
        at,
        rowHash: house.rowHash,
        doNotCall: house.doNotCall,
      }, stamp);
      if (Object.keys(patch).some((key) => !REIMPORT_KEYS.includes(key))) throw new Error('reimport_keys');
      if (commit) {
        await input.db.merge(house.id, patch);
        writes += 1;
      }
      continue;
    }
    created += 1;
    if (commit) {
      await input.db.create(house.id, createDoc(house, at, batchId, stamp));
      writes += 1;
    }
  }
  let retired = 0;
  if (input.retireMissing && input.db?.listHotLeads) {
    let afterId = null;
    for (let page = 0; page < HOT_LIST_PAGES; page += 1) {
      const batch = await input.db.listHotLeads({ limit: HOT_LIST_PAGE, afterId });
      if (!Array.isArray(batch) || batch.length > HOT_LIST_PAGE) throw new Error('hot_list_unbounded');
      for (const item of batch) {
        if (!item?.id || plannedIds.has(item.id) || item.hotStatus === 'retired') continue;
        retired += 1;
        if (commit) {
          await input.db.retire(item.id, retirePatch(at, stamp));
          writes += 1;
        }
      }
      if (batch.length < HOT_LIST_PAGE) break;
      afterId = batch[batch.length - 1]?.id || null;
      if (!afterId) break;
    }
  }
  const output = {
    rowsRead: rows.length,
    skipped: classified.skipped,
    houses: grouped.houses.length,
    created,
    updated,
    unchanged,
    retired,
    geocodeMatched,
    geocodeUnmatched,
    homeownerLinks,
    existingLeadLinks,
    withinSheetMerges: grouped.withinSheetMerges,
    dncImported: classified.dncImported,
    writes,
    dryRun: !commit,
  };
  return { ok: true, code: 0, writes, output, review: reviewCsv(review), cache };
}

export function parseArgs(argv) {
  const args = { commit: false, retireMissing: false, includeDnc: false, includeLost: false, project: null, path: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--commit') args.commit = true;
    else if (token === '--retire-missing') args.retireMissing = true;
    else if (token === '--include-dnc') args.includeDnc = true;
    else if (token === '--include-lost') args.includeLost = true;
    else if (token === '--project') {
      args.project = argv[i + 1] || '';
      i += 1;
    } else if (token.startsWith('--')) return { error: 'unknown_flag' };
    else rest.push(token);
  }
  if (rest.length !== 1) return { error: 'path_required' };
  args.path = rest[0];
  return args;
}

export function parseTable(text, filename) {
  if (String(filename || '').toLowerCase().endsWith('.xlsx')) return parseXlsx(Buffer.isBuffer(text) ? text : Buffer.from(text));
  const parsed = Papa.parse(String(text), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => String(header).trim(),
  });
  return Array.isArray(parsed.data) ? parsed.data.filter((row) => row && typeof row === 'object') : [];
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name]);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const chunk = Buffer.concat([local, nameBuf, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(chunk);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += chunk.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function findEocd(src) {
  const min = Math.max(0, src.length - 22 - 65535);
  for (let offset = src.length - 22; offset >= min; offset -= 1) {
    if (src.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('zip_eocd');
}

/**
 * Reads sizes from the central directory. Google Sheets sets the data-descriptor
 * bit and leaves the local header sizes at 0, which makes inflateRaw throw
 * Z_BUF_ERROR if those zeros are trusted.
 */
export function unzip(buffer) {
  const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocd = findEocd(src);
  const count = src.readUInt16LE(eocd + 10);
  let cursor = src.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (cursor + 46 > src.length || src.readUInt32LE(cursor) !== 0x02014b50) throw new Error('zip_central');
    const method = src.readUInt16LE(cursor + 10);
    const compSize = src.readUInt32LE(cursor + 20);
    const nameLen = src.readUInt16LE(cursor + 28);
    const extraLen = src.readUInt16LE(cursor + 30);
    const commentLen = src.readUInt16LE(cursor + 32);
    const localOffset = src.readUInt32LE(cursor + 42);
    if (compSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('zip64');
    const name = src.toString('utf8', cursor + 46, cursor + 46 + nameLen);
    if (localOffset + 30 > src.length || src.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip_local');
    const localNameLen = src.readUInt16LE(localOffset + 26);
    const localExtraLen = src.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = src.subarray(start, start + compSize);
    let data = Buffer.alloc(0);
    if (!name.endsWith('/')) {
      if (method === 0) data = Buffer.from(compressed);
      else if (method === 8) data = inflateRawSync(compressed);
      else throw new Error('zip_method');
    }
    files.set(name, data);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** Deflate plus a data descriptor, which is how Google Sheets writes xlsx parts. */
export function zipSheets(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const data = Buffer.isBuffer(files[name]) ? files[name] : Buffer.from(files[name]);
    const compressed = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0008, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBuf.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(data.length, 12);
    const chunk = Buffer.concat([local, nameBuf, compressed, descriptor]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0008, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(chunk);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += chunk.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export function columnIndex(letters) {
  let index = 0;
  for (const char of String(letters || '')) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    index = index * 26 + (code - 64);
  }
  return index === 0 ? null : index - 1;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseXlsx(buffer) {
  const files = unzip(buffer);
  let sheet = null;
  for (const [name, data] of files) {
    if (/xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      sheet = data.toString('utf8');
      break;
    }
  }
  if (!sheet) return [];
  const shared = [];
  const sharedXml = files.get('xl/sharedStrings.xml');
  if (sharedXml) {
    const xml = sharedXml.toString('utf8');
    const items = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
    for (const item of items) {
      const texts = [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1]));
      shared.push(texts.join(''));
    }
  }
  const matrix = [];
  const rows = sheet.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  for (const rowXml of rows) {
    const cells = [];
    const matches = rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    for (const cellXml of matches) {
      const ref = / r="([A-Z]+)(\d+)"/.exec(cellXml);
      const column = ref ? columnIndex(ref[1]) : cells.length;
      if (column == null) continue;
      let value = '';
      if (/t="inlineStr"/.test(cellXml)) {
        value = decodeXml((/<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cellXml) || [])[1] || '');
      } else if (/t="s"/.test(cellXml)) {
        const index = Number((/<v>([\s\S]*?)<\/v>/.exec(cellXml) || [])[1] || '');
        value = shared[index] || '';
      } else {
        value = decodeXml((/<v>([\s\S]*?)<\/v>/.exec(cellXml) || [])[1] || '');
      }
      cells[column] = value;
    }
    matrix.push(cells.map((item) => item ?? ''));
  }
  if (!matrix.length) return [];
  const headers = matrix[0].map((header) => String(header).trim());
  return matrix.slice(1).filter((row) => row.some((item) => String(item).trim())).map((row) => {
    const out = {};
    headers.forEach((header, index) => {
      if (header) out[header] = row[index] ?? '';
    });
    return out;
  });
}

export function sidecarPaths(inputPath) {
  return {
    cache: `${inputPath}.geocode-cache.json`,
    review: `${inputPath}.needs-review.csv`,
  };
}

export async function executeCli(argv, deps) {
  const args = parseArgs(argv);
  if (args.error) return { code: 1, output: { error: args.error, writes: 0 } };
  if (args.commit && deps.env?.HOT_LEADS_IMPORT_CONFIRM !== 'yes') {
    return { code: 2, output: { error: 'confirm_required', writes: 0 } };
  }
  const raw = await deps.readFile(args.path);
  const rows = parseTable(raw, args.path);
  const paths = sidecarPaths(args.path);
  const cache = new Map();
  if (deps.readOptional) {
    const existing = await deps.readOptional(paths.cache);
    if (existing) {
      const parsed = JSON.parse(String(existing));
      for (const [key, value] of Object.entries(parsed)) cache.set(key, value);
    }
  }
  let db = null;
  if (args.commit && deps.connect) db = await deps.connect(args.project);
  else if (deps.db) db = deps.db;
  const result = await runImport({
    rows,
    commit: args.commit,
    confirm: deps.env?.HOT_LEADS_IMPORT_CONFIRM,
    includeDnc: args.includeDnc,
    includeLost: args.includeLost,
    retireMissing: args.retireMissing,
    cache,
    db,
    fetchBatch: deps.fetchBatch,
    throttle: deps.throttle,
    batchSize: deps.batchSize,
    at: deps.at,
    batchId: deps.batchId,
  });
  if (deps.writeFile && result.cache) {
    await deps.writeFile(paths.cache, serializeCache(result.cache));
    await deps.writeFile(paths.review, result.review || reviewCsv([]));
  }
  return { code: result.code, output: result.output };
}
