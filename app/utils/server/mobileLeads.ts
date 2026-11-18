import { NextRequest, NextResponse } from 'next/server';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { insideTerritory, territoryBounds } from '@/app/utils/territoryManager';
import { isOwnFollowUp } from '@/app/mobile/_lib/followUps';
import type { Lead } from '@/app/types';
import { loadOwnKnockEventsPage, loadOwnershipContext, ownershipForRows, popupExemptForRole } from './mobileOwnership';
import { knocksAnywhereRole } from '@/app/utils/knockAnywhere';

// No new index or writes. Queries use existing single-field indexes (fieldKnockEvents is a doc-id range).
const PAGE = 500;
export const MOBILE_TERRITORY_LIMIT = 200;
export const SUMMARY_FIELDS = ['name','phone','email','address','city','state','status','disposition','dispositionedAt','dispositionHistory','claimedBy','assignedTo','createdAt','goBackScheduledBy','goBackScheduledDate','goBackScheduledTime','appointmentOutcome','appointmentOutcomeAt','appointmentDateTime','ghlLastUpdatedAt','ghlAppointmentStatus','ghlOpportunityStatus','ghlContactId','ghlAppointmentId','leadType','lat','lng','solarScore','solarCategory','source','setterId','claimedAt','assignedAt','fieldDoor','fieldHandoff','estimatedBill','hasSouthFacingRoof','solarMaxPanels','zip','objectionType','objectionNotes','goBackNotes','tags','ghlStatus','ghlOpportunityId','pipelineStageId','dispositionNotes','notes'];
function jsonValue(x: any): any {
  if (x?.toDate) return x.toDate().toISOString();
  if (x instanceof Date) return x.toISOString();
  if (Array.isArray(x)) return x.map(jsonValue);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,jsonValue(v)]));
  return x;
}
function summary(id: string, data: Record<string, any>, personal = false) {
  // Personal field analysis needs repeat visits, while map rows only need the
  // latest marker outcome. Full notes/photos are fetched on selection.
  const history = personal ? data.dispositionHistory : data.dispositionHistory?.slice(0, 1);
  return jsonValue({ ...data, notes: typeof data.notes === 'string' ? data.notes.slice(0, 1000) : undefined, id, dispositionHistory: history, mobileSummary: true });
}
/**
 * Closers see every rep's pins (Evan, Nov 18 2026; Raydar Mobile D1). A map row is CONTACT-REDACTED
 * when the viewer is a closer, does not own the lead (ownsLead: claimedBy / assignedTo / setterId on a
 * manually-added pin) and the pin is not inside one of the closer's own non-archived territories (a
 * truncated territory read counts as outside: fail closed on contact data, never on visibility).
 * Built as an ALLOWLIST: a redacted row carries exactly these keys, plus a trimmed newest history entry,
 * the ownership extras with names cut to an initial, mobileSummary and contactRedacted. Everything else
 * in SUMMARY_FIELDS (name, phone, email, notes, goBack*, objection*, appointment*, ghl*, claimedBy,
 * assignedTo, setterId, ...) never leaves the server on these rows.
 */
export const CONTACT_REDACTED_KEYS = ['lat','lng','address','city','state','zip','status','disposition','dispositionedAt','leadType','source','solarCategory','createdAt'] as const;
const OWNERSHIP_EXTRA_KEYS = ['ownedByMe','owners','ownerSource','inOtherUsersTerritory'] as const;
/** "Jordan Miller" -> "J." (owner-style initial). */
export function nameInitial(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const first = Array.from(name.trim())[0];
  return first ? `${first.toUpperCase()}.` : null;
}
function ownsLeadRow(l: Record<string, unknown>, uid: string): boolean {
  return l.claimedBy === uid || l.assignedTo === uid || (l.setterId === uid && l.source === 'manually-added');
}
function contactRedactedRow(id: string, data: Record<string, unknown>, extras: Record<string, unknown> | null, uid: string) {
  const row: Record<string, unknown> = { id };
  for (const key of CONTACT_REDACTED_KEYS) if (data[key] !== undefined) row[key] = data[key];
  const top = Array.isArray(data.dispositionHistory) ? data.dispositionHistory[0] : undefined;
  if (top && typeof top === 'object') {
    const e = top as Record<string, unknown>;
    const entry: Record<string, unknown> = {
      disposition: e.disposition,
      timestamp: e.timestamp,
      userId: e.userId,
      userName: e.userId === uid ? e.userName : nameInitial(e.userName),
    };
    const eventId = e.field && typeof e.field === 'object' ? (e.field as Record<string, unknown>).eventId : undefined;
    if (typeof eventId === 'string') entry.field = { eventId };
    row.dispositionHistory = [entry];
  }
  if (extras) {
    for (const key of OWNERSHIP_EXTRA_KEYS) {
      if (!(key in extras)) continue;
      row[key] = key === 'owners' && Array.isArray(extras.owners)
        ? (extras.owners as Array<{ uid: string; name: unknown }>).map((o) => ({ uid: o.uid, name: o.uid === uid ? o.name : nameInitial(o.name) }))
        : extras[key];
    }
  }
  return jsonValue({ ...row, mobileSummary: true, contactRedacted: true });
}
const validId = (id: string) => id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..';
export function createMobileLeadHandler(deps: {adminAuth:()=>Auth;adminDb:()=>Firestore}) {
return async function GET(request: NextRequest) {
  try {
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ')) return NextResponse.json({error:'Sign in to load your pins.'},{status:401});
    const { uid } = await deps.adminAuth().verifyIdToken(bearer.slice(7), true);
    const db = deps.adminDb(), userDoc = await db.collection('users').doc(uid).get(), user = userDoc.data();
    if (!userDoc.exists || user?.deleted || user?.deletionPending || user?.isActive === false || user?.approved === false || user?.approvalStatus === 'pending')
      return NextResponse.json({error:'This account cannot load leads.'},{status:403});
    const p = request.nextUrl.searchParams, mode = p.get('mode');
    if (mode === 'personal') {
      const field = p.get('field') || 'assignedTo';
      if (!['assignedTo','claimedBy','goBackScheduledBy','recent'].includes(field) || (field === 'recent' && user?.role !== 'admin')) throw Error('Invalid personal page.');
      const after = p.get('after');
      if (after && !validId(after)) throw Error('Invalid personal cursor.');
      // Project on the server so a large unworked territory never becomes a phone payload.
      const recent = field === 'recent';
      const from = Timestamp.fromMillis(Math.floor(Date.now()/86400000)*86400000 - 35*86400000);
      let q = recent ? db.collection('leads').where('dispositionedAt','>=',from).orderBy('dispositionedAt').orderBy(FieldPath.documentId()).select(...SUMMARY_FIELDS).limit(PAGE)
        : db.collection('leads').where(field, '==', uid).orderBy(FieldPath.documentId()).select(...SUMMARY_FIELDS).limit(PAGE);
      if (after) {
        if (recent) {
          const seconds=Number(p.get('afterSeconds')), nanoseconds=Number(p.get('afterNanos'));
          if(!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds) || nanoseconds<0 || nanoseconds>=1e9)throw Error('Invalid activity cursor.');
          q=q.startAfter(new Timestamp(seconds,nanoseconds),after);
        } else q=q.startAfter(after);
      }
      const snapshot = await q.get();
      const since = Date.now() - 35 * 86400000;
      const leads = snapshot.docs.map(d => summary(d.id, d.data(), true)).filter((l: Lead) =>
        isOwnFollowUp(l, uid) || ((!recent || (l.dispositionHistory?.[0]?.userId || l.claimedBy || l.assignedTo) === uid) && Date.parse(String(l.dispositionedAt || '')) >= since) ||
        ((l.claimedBy === uid || l.assignedTo === uid) && Date.parse(String(l.ghlLastUpdatedAt || '')) >= since));
      const now = Date.now();
      const ctx = await loadOwnershipContext(db, now);
      // Events are additive: if the read fails (e.g. the composite index is not deployed yet) the phone
      // still gets its leads, just without counts-only events.
      const eventPage = after ? null : await loadOwnKnockEventsPage(db, uid, now).catch((error) => {
        console.log('[mobile/leads] knock_events_failed 1', error instanceof Error ? error.message.slice(0, 120) : '');
        return { events: [], truncated: false };
      });
      const extra = {
        ownership: ctx.mode,
        popupExempt: popupExemptForRole(user?.role),
        ...(eventPage ? { knockEvents: eventPage.events, ...(eventPage.truncated ? { knockEventsTruncated: true } : {}) } : {}),
      };
      return NextResponse.json({leads, ...extra, nextCursor:snapshot.size === PAGE ? snapshot.docs.at(-1)!.id : null, ...(recent && snapshot.size === PAGE ? {afterSeconds:snapshot.docs.at(-1)!.data().dispositionedAt.seconds,afterNanos:snapshot.docs.at(-1)!.data().dispositionedAt.nanoseconds} : {})}, { headers:{'Cache-Control':'private, no-store'} });
    }
    if (mode !== 'map') throw Error('Choose a lead view.');
    const [south,north,west,east] = ['south','north','west','east'].map(key => Number(p.get(key)));
    const zoom = Number(p.get('zoom'));
    if (![south,north,west,east,zoom].every(Number.isFinite) || zoom < 15 || north <= south || east <= west || north-south > .06 || east-west > .09 || south < -85 || north > 85 || west < -180 || east > 180)
      throw Error('Zoom closer to load this neighborhood.');
    const browseAll = ['admin','manager'].includes(user?.role);
    // Closers see every rep's pins in the viewport (same bounded read). Their own territories still load,
    // only to decide which rows keep the full summary (see contactRedactedRow).
    const closerView = knocksAnywhereRole(user?.role);
    const territorySnap = browseAll ? null : await db.collection('territories').where('userId','==',uid).select('polygon','archived').limit(MOBILE_TERRITORY_LIMIT).get();
    const territoriesTruncated = Boolean(territorySnap && territorySnap.size >= MOBILE_TERRITORY_LIMIT);
    if (territoriesTruncated) console.log('[mobile/leads] territories truncated');
    const truncatedBody = territoriesTruncated ? { truncated: true as const } : {};
    const territories = territorySnap ? territorySnap.docs.map(d=>d.data()).filter(t=>!t.archived && Array.isArray(t.polygon) && t.polygon.length>=3) : null;
    const overlapping = territories?.filter(t=>{const b=territoryBounds(t.polygon); return b.north>=south && b.south<=north && b.east>=west && b.west<=east;});
    if (!closerView && overlapping && !overlapping.length) return NextResponse.json({leads:[],nextCursor:null,...truncatedBody});
    const inMine = (l: { lat?: unknown; lng?: unknown }) => !overlapping || overlapping.some(t=>insideTerritory(l.lat as number,l.lng as number,t.polygon));
    let q = db.collection('leads').where('lat','>=',south).where('lat','<=',north).orderBy('lat').orderBy(FieldPath.documentId()).select(...SUMMARY_FIELDS).limit(PAGE);
    const after = p.get('after'), afterLat = Number(p.get('afterLat'));
    if (after) { if (!validId(after) || !Number.isFinite(afterLat) || afterLat < south || afterLat > north) throw Error('Invalid map cursor.'); q=q.startAfter(afterLat,after); }
    const snapshot = await q.get();
    const kept = snapshot.docs.filter(d=>{const l=d.data(); return typeof l.lng==='number' && l.lng>=west && l.lng<=east && (closerView || inMine(l));});
    const now = Date.now();
    const ctx = await loadOwnershipContext(db, now);
    const owned = await ownershipForRows(db, ctx, kept.map(d=>d.data()), uid, now);
    const leads = kept.map((d,i)=>{
      const l = d.data();
      const full = !closerView || ownsLeadRow(l, uid) || (!territoriesTruncated && inMine(l));
      return full ? {...summary(d.id,l), ...(owned[i] || {})} : contactRedactedRow(d.id, l, owned[i] || null, uid);
    });
    const last = snapshot.docs.at(-1);
    return NextResponse.json({leads, ownership: ctx.mode, popupExempt: popupExemptForRole(user?.role), scanned:snapshot.size, nextCursor:snapshot.size===PAGE ? {id:last!.id,lat:last!.data().lat}:null, ...truncatedBody}, {headers:{'Cache-Control':'private, no-store'}});
  } catch (e: any) {
    const unauthorized = String(e?.code||'').startsWith('auth/');
    return NextResponse.json({error:unauthorized ? 'Sign in again to load leads.' : 'Leads could not load. Please retry.'},{status:unauthorized ? 401 : 400});
  }
}

}
