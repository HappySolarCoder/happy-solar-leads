import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/territoryFixture';
import { cleanFingerTrace } from '../../app/mobile/territories/drawing';
import { matchesMapFilters } from '../../app/mobile/_lib/mapFilters';
import type { Lead } from '../../app/types';
const polygon = [{ lat: 43, lng: -77 }, { lat: 43, lng: -76.98 }, { lat: 43.02, lng: -76.98 }, { lat: 43.02, lng: -77 }];
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function finish(f: ReturnType<typeof fixture>, initial: any) { let r = initial; let calls = 0; while (!r.done) {
    const response = await f.request({ action: 'continue-assignment', id: r.id, operationId: r.operationId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    r = response.body;
    assert.ok(++calls < 50);
} return r; }
test('large territories scan beyond 1000 pins, assign over 400 in resumable batches, and transfer safely', async () => {
    const f = fixture();
    for (let i = 0; i < 650; i++)
        f.seed(`leads/pin-${String(i).padStart(4, '0')}`, { lat: 43.005, lng: -76.99, status: 'unclaimed', notes: 'Keep' });
    for (let i = 0; i < 1200; i++)
        f.seed(`leads/outside-${i}`, { lat: 43.005, lng: -70, status: 'unclaimed' });
    f.seed('leads/appointment', { lat: 43.005, lng: -76.99, status: 'appointment', assignedTo: 'rep', notes: 'Appointment' });
    let cursor = null, eligible = 0, scanned = 0;
    do {
        const p = await f.request({ action: 'preview-v2', userId: 'rep', polygon, cursor });
        assert.equal(p.status, 200);
        eligible += p.body.eligible;
        scanned += p.body.scanned;
        cursor = p.body.nextCursor;
    } while (cursor);
    assert.equal(eligible, 650);
    assert.equal(scanned, 1851);
    const begin = { action: 'begin-assignment', kind: 'create', userId: 'rep', polygon, name: 'Large area', requestId };
    const started = await f.request(begin);
    assert.equal(started.status, 200);
    assert.equal((await f.request(begin)).body.operationId, requestId);
    let partial = started.body;
    while (partial.changed === 0) {
        const r = await f.request({ action: 'continue-assignment', id: partial.id, operationId: requestId });
        assert.equal(r.status, 200);
        partial = r.body;
    }
    const before = structuredClone(f.records.get(`territories/${requestId}`));
    f.setFailure(true);
    assert.equal((await f.request({ action: 'continue-assignment', id: requestId, operationId: requestId })).status, 503);
    assert.deepEqual(f.records.get(`territories/${requestId}`), before);
    f.setFailure(false);
    // A rep knocks a later pin before its batch: keep that new activity.
    f.seed('leads/pin-0649', { lat: 43.005, lng: -76.99, status: 'not-home', claimedBy: 'next', notes: 'Fresh knock' });
    const saved = await finish(f, partial);
    assert.equal(saved.changed, 649);
    assert.equal(f.records.get(`territories/${requestId}`)!.value.leadCount, 649);
    assert.deepEqual(f.records.get(`territories/${requestId}`)!.value.leadIds, []);
    assert.equal(f.records.get('leads/pin-0649')!.value.claimedBy, 'next');
    assert.equal(f.records.get('leads/appointment')!.value.status, 'appointment');
    const replay = await f.request({ action: 'continue-assignment', id: requestId, operationId: requestId });
    assert.equal(replay.body.changed, 649);
    const data = (await f.request()).body;
    assert.equal(data.capabilities.pagedAssignments, true);
    const moved = await f.request({ action: 'begin-assignment', kind: 'transfer', id: requestId, userId: 'next', version: data.territories[0].version, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    assert.equal(moved.status, 200);
    const transferred = await finish(f, moved.body);
    assert.equal(transferred.changed, 649);
    assert.equal(f.records.get('leads/pin-0000')!.value.assignedTo, 'next');
    assert.equal(f.records.get('leads/pin-0000')!.value.notes, 'Keep');
    assert.equal(f.records.get(`territories/${requestId}`)!.value.userId, 'next');
});
test('each continued batch checks authorization; edits cannot interrupt an unfinished assignment', async () => {
    const f = fixture();
    f.seed('leads/pin', { lat: 43.005, lng: -76.99, status: 'unclaimed' });
    const b = (await f.request({ action: 'begin-assignment', kind: 'create', userId: 'rep', polygon, name: 'Safe', requestId })).body;
    const area = (await f.request()).body.territories[0];
    assert.equal((await f.request({ action: 'rename', id: area.id, name: 'Changed', version: area.version, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).status, 409);
    f.seed('users/manager', { role: 'manager', team: 'B' });
    assert.equal((await f.request({ action: 'continue-assignment', id: b.id, operationId: b.operationId })).status, 403);
    assert.equal(f.records.get('leads/pin')!.value.assignedTo, undefined);
});
test('legacy territory IDs with spaces and punctuation can be deleted without modifying lead history', async () => {
    const f = fixture();
    f.seed('territories/Rep area.2026', { name: 'Legacy', userId: 'rep', polygon, leadIds: [] });
    const a = (await f.request()).body.territories[0];
    assert.equal((await f.request({ action: 'archive', id: a.id, version: a.version, requestId })).status, 200);
    assert.equal((await f.request({ action: 'archive', id: '../bad', version: 'x', requestId })).status, 400);
});
test('finger traces snap near the start and erase small return loops without reshaping real crossings', () => {
    const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: -3, y: 8 }, { x: 3, y: -2 }];
    assert.equal(cleanFingerTrace(square).length, 4);
    const crossed = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }];
    assert.deepEqual(cleanFingerTrace(crossed), crossed);
});
test('map dates accept Firestore timestamps, exclude unworked doors, and combine with authoritative disposition', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const d = [{ id: 'not-home', name: 'Not Home' }] as any;
    const lead = { status: 'not-home', dispositionedAt: { seconds: Date.parse('2026-10-10T00:00:00Z') / 1000 } } as unknown as Lead;
    assert.equal(matchesMapFilters(lead, 'week', ['not-home'], d, now), true);
    assert.equal(matchesMapFilters(lead, 'week', ['appointment'], d, now), false);
    assert.equal(matchesMapFilters({ status: 'assigned' } as Lead, 'week', [], d, now), false);
    assert.equal(matchesMapFilters({ ...lead, status: 'appointment', dispositionHistory: [{ disposition: 'Not Home', timestamp: now, userId: 'rep', userName: 'Rep' }] } as Lead, 'all', ['not-home'], d, now), false);
});
