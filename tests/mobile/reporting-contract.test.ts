import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase/firestore';
import { DEFAULT_DISPOSITIONS } from '../../app/types/disposition';
import type { Lead, User } from '../../app/types';
import type { PendingMutation } from '../../app/field/types';
import { knockPatch } from '../../app/field/knockPatch';
import { directPatch, reportingPatch, mergeReportingPatch, firestoreValue } from '../../app/field/directWrites';
import { restFields } from '../../app/field/createLeadOnce';
import {
  AMBIGUOUS_SEND_MESSAGE,
  SCHEDULING_ROUTE_PATH,
  sendSchedulingNotification,
  type SchedulingPayload,
} from '../../app/utils/schedulingNotification';
import { assertProductionConfig } from '../../scripts/mobile/production-config.mjs';

const user = { id: 'firebase-rep-uid', name: 'Test Rep' } as User;
const lead = { id: 'fixture', status: 'claimed', claimedBy: 'owner-uid', assignedTo: 'assigned-uid',
  territoryId: 'keep-territory', notes: 'existing', dispositionHistory: [] } as unknown as Lead;
const at = new Date('2026-10-11T16:58:00.123Z');
const gps = { knockGpsLat: 43.2085, knockGpsLng: -77.5778, knockGpsAccuracy: 5,
  knockGpsTimestamp: new Date('2026-10-11T16:58:01.001Z'), knockDistanceFromAddress: 7.1 };
function mutation(patch: Partial<Lead>): PendingMutation {
  return { id: 'local-id', userId: user.id, userName: user.name, leadId: lead.id,
    kind: 'knock', createdAt: at.toISOString(), baseStatus: lead.status,
    status: patch.status, disposition: patch.dispositionHistory?.[0].disposition, direct: { patch } };
}
test('every configured common disposition uses its existing ID, rep UID/name, one action time and GPS', () => {
  for (const d of DEFAULT_DISPOSITIONS.filter(d => !['claimed', 'unclaimed'].includes(d.id))) {
    const patch = knockPatch(lead, user, user.id, d, at, gps);
    const result = reportingPatch(mutation(patch), user);
    assert.equal(result.status, d.id);
    assert.deepEqual(result.dispositionHistory?.[0], { disposition: d.name, timestamp: at, userId: user.id, userName: user.name });
    assert.equal(result.dispositionedAt?.getTime(), at.getTime());
    for (const [key, value] of Object.entries(gps)) assert.deepEqual(result[key as keyof Lead], value);
    assert.equal('claimedBy' in result, false); assert.equal('assignedTo' in result, false);
    assert.equal('territoryId' in result, false);
    const written = firestoreValue(result) as { dispositionedAt: Timestamp; dispositionHistory: {timestamp: Timestamp}[]; knockGpsTimestamp: Timestamp };
    assert.ok(written.dispositionedAt instanceof Timestamp);
    assert.equal(written.dispositionedAt.toMillis(), at.getTime());
    assert.ok(written.dispositionHistory[0].timestamp instanceof Timestamp);
    assert.ok(written.knockGpsTimestamp instanceof Timestamp);
  }
});
test('rejects profile/UID mismatch and never turns a disposition into an ownership edit', () => {
  assert.throws(() => knockPatch(lead, user, 'another-uid', DEFAULT_DISPOSITIONS[2], at));
  assert.throws(() => knockPatch(lead, user, undefined, DEFAULT_DISPOSITIONS[2], at));
  for (const d of DEFAULT_DISPOSITIONS.slice(0, 2)) assert.throws(() => knockPatch(lead, user, user.id, d, at));
  assert.deepEqual(directPatch({ claimedBy: 'changed', assignedTo: 'changed', status: 'not-home', notes: 'text' }), { status: 'not-home', notes: 'text' });
});
test('offline replay preserves original time, newest-first history, and prevents duplicate counting', () => {
  const patch = reportingPatch(mutation(knockPatch(lead, user, user.id, DEFAULT_DISPOSITIONS[2], at, gps)), user);
  const once = mergeReportingPatch(lead, patch);
  assert.equal(once.replayed, false);
  const again = mergeReportingPatch({ ...lead, ...once.patch }, patch);
  assert.equal(again.replayed, true); assert.deepEqual(again.patch, {});
  const newerAt = new Date(at.getTime() + 100000);
  const newer = { ...lead, status: 'appointment', dispositionedAt: newerAt,
    dispositionHistory: [{ disposition: 'Appointment Set', timestamp: newerAt, userId: 'other-rep', userName: 'Other Rep' }] };
  const late = mergeReportingPatch(newer, patch);
  assert.deepEqual(Object.keys(late.patch), ['dispositionHistory']);
  assert.equal(late.patch.dispositionHistory?.[0].timestamp, newerAt);
  assert.equal(late.patch.dispositionHistory?.[1].timestamp.getTime(), at.getTime());
});
test('objection and go-back fields keep their web names and Timestamp types in both write transports', () => {
  const extras = { ...gps, objectionType: 'cost' as Lead['objectionType'], objectionNotes: 'Example',
    objectionRecordedAt: at, objectionRecordedBy: user.id, goBackScheduledDate: new Date('2026-10-13T16:00:00Z'),
    goBackScheduledTime: '12:00', goBackNotes: 'Example return', goBackScheduledBy: user.id };
  const patch = reportingPatch(mutation(knockPatch(lead, user, user.id, DEFAULT_DISPOSITIONS[4], at, extras)), user);
  const rest = restFields(patch as Record<string, unknown>);
  assert.deepEqual(rest.dispositionedAt, { timestampValue: at.toISOString() });
  assert.deepEqual(rest.knockGpsTimestamp, { timestampValue: gps.knockGpsTimestamp.toISOString() });
  assert.deepEqual(rest.objectionRecordedAt, { timestampValue: at.toISOString() });
  assert.deepEqual(rest.goBackScheduledDate, { timestampValue: extras.goBackScheduledDate.toISOString() });
  assert.equal(patch.goBackScheduledBy, user.id); assert.equal(patch.objectionRecordedBy, user.id);
});
test('legacy API draft recovery uses captured event time/GPS rather than reconnect time', () => {
  const m: PendingMutation = { id: 'legacy', userId: user.id, leadId: lead.id, createdAt: at.toISOString(),
    kind: 'knock', baseStatus: 'claimed', status: 'not-interested', disposition: 'Not Interested',
    objectionType: 'cost', objectionNotes: 'Example', observation: { gps: {lat:43,lng:-77,accuracy:5,timestamp:at.toISOString()} } as PendingMutation['observation'] };
  const patch = reportingPatch(m, user);
  assert.equal(patch.dispositionedAt?.getTime(), at.getTime());
  assert.equal(patch.dispositionHistory?.[0].userName, user.name);
  assert.equal(patch.knockGpsTimestamp?.getTime(), at.getTime());
  assert.equal(patch.objectionRecordedBy, user.id);
});
test('production mobile config rejects a preview backend or another Firebase project', () => {
  const env = { NEXT_PUBLIC_API_BASE_URL: 'https://happy-solar-leads.vercel.app',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'gen-lang-client-0395385938',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'gen-lang-client-0395385938.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'fixture', NEXT_PUBLIC_FIREBASE_APP_ID: '1:143988544112:web:fixture' };
  assert.doesNotThrow(() => assertProductionConfig(env));
  assert.throws(() => assertProductionConfig({ ...env, NEXT_PUBLIC_API_BASE_URL: 'https://preview.example.com' }));
  assert.throws(() => assertProductionConfig({ ...env, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'other-project' }));
});
test('scheduling route posts once and does not retry an ambiguous response', async () => {
  const payload: SchedulingPayload = {
    kind: 'scheduling', name: 'Ada', address: '1 Main', city: 'Rochester', state: 'NY', zip: '14601', phone: '555',
  };
  let calls = 0;
  const sent = await sendSchedulingNotification(payload, {
    getToken: async () => 'token',
    post: async (path, init) => {
      calls += 1;
      assert.equal(path, SCHEDULING_ROUTE_PATH);
      assert.equal(path.includes('http'), false);
      assert.equal(init.method, 'POST');
      const body = JSON.parse(String(init.body)) as SchedulingPayload;
      assert.equal(body.kind, 'scheduling');
      assert.equal('content' in body, false);
      assert.equal('text' in body, false);
      assert.equal('message' in body, false);
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer token');
      assert.equal(headers['Content-Type'], 'application/json');
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(sent.status, 'sent');
  calls = 0;
  const ambiguous = await sendSchedulingNotification(payload, {
    getToken: async () => 'token',
    post: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'Discord did not accept the notification.' }), { status: 502 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(ambiguous.status, 'ambiguous');
  if (ambiguous.status === 'ambiguous') assert.equal(ambiguous.message, AMBIGUOUS_SEND_MESSAGE);
});
