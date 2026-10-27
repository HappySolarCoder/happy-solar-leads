// Notes blank guard (direct client writes). Run with the Firestore emulator:
//   firebase emulators:exec --only firestore --project demo-happy-solar "npx tsx --test tests/firestore-rules-notes-guard.test.ts"
// The route /api/field/dispo writes with the Admin SDK, so it is not covered here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const RULES = readFileSync(process.env.RULES_FILE || new URL('../firestore.rules', import.meta.url), 'utf8');
const ACTIVE = { isActive: true, approved: true, approvalStatus: 'approved', status: 'active', deleted: false, deletionPending: false };
const S = 'Gate code 1234\nDog in yard';
const NINE = { name: 'Homeowner', address: '1 Main St', city: 'Buffalo', state: 'NY', zip: '14201', phone: '7165550100', email: 'home@example.com', estimatedBill: 150 };
type Outcome = 'allow' | 'deny';
type Case = { id: string; uid: string; seed: Record<string, unknown>; write: Record<string, unknown> | (() => Record<string, unknown>); expect: Outcome; final?: unknown };

const own = { status: 'assigned', assignedTo: 'owner' };
const del = () => firebase.firestore.FieldValue.delete();
const CASES: Case[] = [
  // 14.18 blank sends (aca724f / 803fb1a shape: {notes:''} only)
  { id: 'owner (assigned) notes "" over text', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { notes: '' }, expect: 'deny', final: S },
  { id: 'owner (claimed) notes "" over text', uid: 'owner', seed: { status: 'claimed', claimedBy: 'owner', notes: S }, write: { notes: '' }, expect: 'deny', final: S },
  { id: 'owner (manual) notes "" over text', uid: 'owner', seed: { status: 'new', source: 'manually-added', setterId: 'owner', notes: S }, write: { notes: '' }, expect: 'deny', final: S },
  { id: 'owner notes whitespace over text', uid: 'owner', seed: { ...own, notes: S }, write: { notes: '   ' }, expect: 'deny', final: S },
  { id: 'owner notes newline/tab over text', uid: 'owner', seed: { ...own, notes: S }, write: { notes: '\n\t ' }, expect: 'deny', final: S },
  { id: 'owner notes null over text', uid: 'owner', seed: { ...own, notes: S }, write: { notes: null }, expect: 'deny', final: S },
  { id: 'owner notes "" plus phone over text', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { notes: '', phone: '7165550199' }, expect: 'deny', final: S },
  // 14.17 deliberate direct clears (behaviour change: now denied; 14.19 clears use the route)
  { id: '14.17 editor clear: 9 keys + notes ""', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { ...NINE, notes: '' }, expect: 'deny', final: S },
  { id: '14.17 detail clear: notes ""', uid: 'owner', seed: { ...own, notes: S }, write: { notes: '' }, expect: 'deny', final: S },
  // still allowed
  { id: '14.17 contact save resends same notes', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { ...NINE, phone: '7165550199', notes: S }, expect: 'allow', final: S },
  { id: '14.17 editor resend notes "" on lead without notes', uid: 'owner', seed: { ...own, name: 'Homeowner' }, write: { ...NINE, notes: '' }, expect: 'allow', final: '' },
  { id: 'owner notes "" over ""', uid: 'owner', seed: { ...own, notes: '' }, write: { notes: '', phone: '1' }, expect: 'allow', final: '' },
  { id: 'owner notes "" over whitespace', uid: 'owner', seed: { ...own, notes: '   ' }, write: { notes: '' }, expect: 'allow', final: '' },
  { id: 'owner notes "" over null', uid: 'owner', seed: { ...own, notes: null }, write: { notes: '' }, expect: 'allow', final: '' },
  { id: 'owner deleteField notes (explicit direct clear)', uid: 'owner', seed: { ...own, notes: S }, write: () => ({ notes: del() }), expect: 'allow', final: undefined },
  { id: 'owner replaces text', uid: 'owner', seed: { ...own, notes: S }, write: { notes: 'New text' }, expect: 'allow', final: 'New text' },
  { id: 'owner text with surrounding spaces', uid: 'owner', seed: { ...own, notes: S }, write: { notes: '  x  ' }, expect: 'allow', final: '  x  ' },
  { id: 'owner phone only (14.19 shape)', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { phone: '7165550199' }, expect: 'allow', final: S },
  { id: 'owner email+phone (Send Info)', uid: 'owner', seed: { ...own, ...NINE, notes: S }, write: { email: 'a@b.co', phone: '7165550199' }, expect: 'allow', final: S },
  { id: 'owner knock only', uid: 'owner', seed: { ...own, notes: S }, write: { status: 'not-home', dispositionedAt: new Date() }, expect: 'allow', final: S },
  // unchanged branches
  { id: 'admin notes "" over text (isAdmin, out of scope)', uid: 'admin', seed: { status: 'new', notes: S }, write: { notes: '' }, expect: 'allow', final: '' },
  { id: 'territory setter notes "" over text (already denied: add-only)', uid: 'setter', seed: { status: 'new', territoryId: 'terr', notes: S }, write: { notes: '' }, expect: 'deny', final: S },
  { id: 'manager notes "" over text non-owned (already denied)', uid: 'manager', seed: { status: 'new', notes: S }, write: { notes: '' }, expect: 'deny', final: S },
];

async function outcome(p: Promise<unknown>): Promise<Outcome> {
  try { await p; return 'allow'; } catch (e) {
    const code = String((e as { code?: unknown })?.code || '');
    if (!code.includes('permission-denied')) throw e;
    return 'deny';
  }
}

describe('notes blank guard', { concurrency: 1 }, () => {
  it('denies blanking non-blank notes on the owner path and keeps everything else', async () => {
    const env: RulesTestEnvironment = await initializeTestEnvironment({ projectId: 'demo-notes-guard', firestore: { rules: RULES } });
    try {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const [id, role] of [['owner', 'setter'], ['setter', 'setter'], ['manager', 'manager'], ['admin', 'admin']])
          await db.collection('users').doc(id).set({ ...ACTIVE, role, name: id });
        await db.collection('territories').doc('terr').set({ userId: 'setter' });
        for (const [i, c] of CASES.entries()) await db.collection('leads').doc(`g${i}`).set(c.seed);
      });
      const bad: string[] = [];
      for (const [i, c] of CASES.entries()) {
        const db = env.authenticatedContext(c.uid, { firebase: { sign_in_provider: 'password' } }).firestore();
        const w = typeof c.write === 'function' ? c.write() : c.write;
        const got = await outcome(db.collection('leads').doc(`g${i}`).update(w));
        let final: unknown;
        await env.withSecurityRulesDisabled(async (ctx) => { final = (await ctx.firestore().collection('leads').doc(`g${i}`).get()).data()?.notes; });
        const ok = got === c.expect && (!('final' in c) || final === c.final);
        console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}: ${got} notes=${JSON.stringify(final)}`);
        if (!ok) bad.push(c.id);
      }
      assert.deepEqual(bad, []);
    } finally { await env.cleanup(); }
  });
});
