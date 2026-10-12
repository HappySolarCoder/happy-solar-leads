import type { TerritoryPoint } from '@/app/types/territory';
import { FieldPath, type Firestore, type DocumentSnapshot, type Query } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { assignableTerritoryLead, inManagerTeam, insideTerritory, mayManageTerritories, mayReceiveTerritory, polygonsOverlap, territoryBounds, validateTerritoryPolygon, type TerritoryMember } from '../territoryManager';
// Work limits are per request, never per territory. No unbounded leadIds array.
export const TERRITORY_PAGE_SIZE = 200;
type Cursor = {
    lat: number;
    id: string;
};
type Operation = {
    id: string;
    kind: 'create' | 'transfer';
    actorId: string;
    targetId: string;
    fromId: string;
    cursor: Cursor | null;
    changed: number;
    skipped: number;
    scanned: number;
    done: boolean;
};
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export const validTerritoryId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && v !== '.' && v !== '..';
const revision = (d: DocumentSnapshot) => d.updateTime ? `${d.updateTime.seconds}:${d.updateTime.nanoseconds}` : '';
function person(d: DocumentSnapshot): TerritoryMember { const v = d.data() || {}; return { ...v, id: d.id, name: v.name || 'Unnamed rep', color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : '#587E98' }; }
function cursor(value: unknown): Cursor | null { if (value == null)
    return null; const c = value as Cursor; if (!Number.isFinite(c.lat) || !validTerritoryId(c.id))
    fail('Invalid territory page.'); return { lat: c.lat, id: c.id }; }
function scan(db: Firestore, polygon: TerritoryPoint[], after: Cursor | null): Query {
    const bounds = territoryBounds(polygon);
    let query = db.collection('leads').where('lat', '>=', bounds.south).where('lat', '<=', bounds.north).orderBy('lat').orderBy(FieldPath.documentId()).limit(TERRITORY_PAGE_SIZE);
    if (after)
        query = query.startAfter(after.lat, after.id);
    return query;
}
function nextCursor(docs: DocumentSnapshot[]): Cursor | null { const last = docs.at(-1); return last ? { lat: last.data()!.lat, id: last.id } : null; }
function progress(id: string, op: Operation) { return { success: true, id, operationId: op.id, changed: op.changed, skipped: op.skipped, scanned: op.scanned, done: op.done }; }
/** Paged preview and resumable assignment. Every batch rechecks role, team,
 * ownership, current lead status, and job cursor inside its transaction. */
export async function territoryV2(db: Firestore, actor: TerritoryMember, body: Record<string, any>) {
    const action = body.action;
    if (action === 'preview-v2') {
        const polygon = validateTerritoryPolygon(body.polygon);
        if (!validTerritoryId(body.userId))
            fail('Choose a rep.');
        const target = person(await db.collection('users').doc(body.userId).get());
        if (!inManagerTeam(actor, target) || !mayReceiveTerritory(target))
            fail('Choose an active rep on your team.', 403);
        const result = await scan(db, polygon, cursor(body.cursor)).get();
        const candidates = result.docs.filter(d => insideTerritory(d.data().lat, d.data().lng, polygon)).map(d => ({ id: d.id, lat: d.data().lat, lng: d.data().lng, version: revision(d), eligible: assignableTerritoryLead(d.data(), target.id) }));
        const eligible = candidates.filter(d => d.eligible).length;
        return { candidates, eligible, skipped: candidates.length - eligible, truncated: false, scanned: result.size, nextCursor: result.size === TERRITORY_PAGE_SIZE ? nextCursor(result.docs) : null };
    }
    if (!validTerritoryId(body.id || body.requestId))
        fail('Choose a territory.');
    const id = String(body.id || body.requestId), ref = db.collection('territories').doc(id);
    if (action === 'begin-assignment') {
        if (!/^[\da-f-]{36}$/i.test(body.requestId) || !['create', 'transfer'].includes(body.kind))
            fail('Invalid assignment request.');
        if (!validTerritoryId(body.userId))
            fail('Choose a rep.');
        const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        return db.runTransaction(async (tx) => {
            const freshActor = person(await tx.get(db.collection('users').doc(actor.id)));
            if (!mayManageTerritories(freshActor))
                fail('Your territory permissions changed.', 403);
            const existing = await tx.get(ref), data = existing.data();
            const target = person(await tx.get(db.collection('users').doc(body.userId)));
            if (!mayReceiveTerritory(target) || !inManagerTeam(freshActor, target))
                fail('Choose an active rep on your team.', 403);
            if (data && data.assignment?.id === body.requestId) {
                if (data.assignment.actorId !== actor.id || data.assignmentHash !== fingerprint)
                    fail('This request was already used for another assignment.', 409);
                return progress(id, data.assignment);
            }
            if (body.kind === 'create' && existing.exists)
                fail('This territory already exists. Refresh your list.', 409);
            if (body.kind === 'transfer' && (!existing.exists || data?.archived || revision(existing) !== body.version))
                fail('This territory changed. Refresh before transferring.', 409);
            if (data?.assignment && !data.assignment.done)
                fail('Resume the unfinished assignment first.', 409);
            if (existing.exists) {
                const owner = person(await tx.get(db.collection('users').doc(data!.userId)));
                if (!inManagerTeam(freshActor, owner))
                    fail('This territory belongs to another team.', 403);
            }
            const polygon = validateTerritoryPolygon(body.kind === 'create' ? body.polygon : data?.polygon);
            const name = body.kind === 'create' ? String(body.name || '').trim() : data?.name;
            if (body.kind === 'create' && (!name || name.length > 60))
                fail('Use a territory name of 1–60 characters.');
            if (body.kind === 'create') {
                const areas = await tx.get(db.collection('territories'));
                if (areas.docs.some(d => !d.data().archived && Array.isArray(d.data().polygon) && polygonsOverlap(polygon, d.data().polygon)))
                    fail('This boundary overlaps a saved territory. Adjust the boundary before assigning.', 409);
            }
            const operation: Operation = { id: body.requestId, kind: body.kind, actorId: actor.id, targetId: target.id, fromId: body.kind === 'transfer' ? data!.userId : '', cursor: null, changed: 0, skipped: 0, scanned: 0, done: false };
            const metadata = { assignment: operation, assignmentHash: fingerprint, updatedAt: new Date().toISOString(), updatedBy: actor.id };
            if (body.kind === 'create')
                tx.create(ref, { ...metadata, name, polygon, userId: target.id, userName: target.name, userColor: target.color, leadIds: [], leadCount: 0, createdAt: new Date().toISOString(), createdBy: actor.id });
            else
                tx.update(ref, metadata);
            return progress(id, operation);
        });
    }
    if (action !== 'continue-assignment')
        fail('Unknown territory action.');
    const initial = await ref.get(), starting = initial.data(), op = starting?.assignment as Operation | undefined;
    if (!op || op.id !== body.operationId)
        fail('This assignment is no longer available. Refresh your list.', 409);
    // Scope check precedes the range query as well as each write transaction.
    const [ownerDoc, targetDoc] = await Promise.all([db.collection('users').doc(starting!.userId).get(), db.collection('users').doc(op.targetId).get()]);
    if (!inManagerTeam(actor, person(ownerDoc)) || !inManagerTeam(actor, person(targetDoc)))
        fail('This territory belongs to another team.', 403);
    if (op.done)
        return progress(id, op);
    const polygon = validateTerritoryPolygon(starting!.polygon);
    const page = await scan(db, polygon, op.cursor).get();
    return db.runTransaction(async (tx) => {
        const freshActor = person(await tx.get(db.collection('users').doc(actor.id)));
        const fresh = await tx.get(ref), data = fresh.data(), current = data?.assignment as Operation | undefined;
        if (!mayManageTerritories(freshActor))
            fail('Your territory permissions changed.', 403);
        if (!current || current.id !== op.id || data?.archived)
            fail('The territory changed. Refresh before continuing.', 409);
        const owner = person(await tx.get(db.collection('users').doc(data!.userId)));
        const target = person(await tx.get(db.collection('users').doc(current.targetId)));
        if (!inManagerTeam(freshActor, owner) || !inManagerTeam(freshActor, target) || !mayReceiveTerritory(target))
            fail('The assignment permissions changed. Ask your manager to review it.', 403);
        if (current.done || JSON.stringify(current.cursor) !== JSON.stringify(op.cursor))
            return progress(id, current);
        const docs = page.docs.length ? await tx.getAll(...page.docs.map(d => d.ref)) : [];
        const legacyIds = new Set<string>(Array.isArray(data!.leadIds) ? data!.leadIds : []);
        let changed = 0, skipped = 0;
        for (const doc of docs) {
            const lead = doc.data();
            if (!lead || !insideTerritory(lead.lat, lead.lng, polygon))
                continue;
            const belongs = current.kind === 'create' || (lead.assignedTo === current.fromId && (lead.territoryId === id || legacyIds.has(doc.id)));
            if (!belongs || !assignableTerritoryLead(lead, target.id, current.kind === 'transfer' ? current.fromId : undefined)) {
                skipped++;
                continue;
            }
            tx.update(doc.ref, { assignedTo: target.id, assignedAt: new Date().toISOString(), autoAssigned: false, ...(lead.status === 'unclaimed' ? { status: 'assigned' } : {}), ...(lead.assignedTo ? { lastAssignedTo: lead.assignedTo } : {}), territoryAssignedBy: actor.id, territoryId: id });
            changed++;
        }
        const next: Operation = { ...current, cursor: nextCursor(page.docs) || current.cursor, changed: current.changed + changed, skipped: current.skipped + skipped, scanned: current.scanned + page.size, done: page.size < TERRITORY_PAGE_SIZE };
        const metadata = { assignment: next, updatedAt: new Date().toISOString(), updatedBy: actor.id };
        tx.update(ref, next.done ? { ...metadata, userId: target.id, userName: target.name, userColor: target.color, leadIds: [], leadCount: next.changed, lastChangedCount: next.changed } : metadata);
        return progress(id, next);
    });
}
