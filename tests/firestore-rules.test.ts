import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

type Outcome = 'allow' | 'deny';
type Provider = 'password' | 'anonymous';
type Firestore = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

type RuleCase = {
  id: string;
  uid: string;
  provider?: Provider;
  run: (db: Firestore) => Promise<unknown>;
  expectTight: Outcome;
  exists?: boolean;
};

const DEPLOYED = readFileSync(new URL('./fixtures/deployed.rules', import.meta.url), 'utf8');
const TIGHT = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const ACTIVE = {
  isActive: true,
  approved: true,
  approvalStatus: 'approved',
  status: 'active',
  deleted: false,
  deletionPending: false,
};

function token(provider: Provider) {
  return { firebase: { sign_in_provider: provider } };
}

function client(env: RulesTestEnvironment, uid: string, provider: Provider, cache: Map<string, Firestore>): Firestore {
  const key = `${uid}:${provider}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const db = env.authenticatedContext(uid, token(provider)).firestore();
  cache.set(key, db);
  return db;
}

async function verdict(promise: Promise<unknown>): Promise<Outcome> {
  try {
    await promise;
    return 'allow';
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
    if (code.includes('permission-denied')) return 'deny';
    throw error;
  }
}

async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const users: Record<string, Record<string, unknown>> = {
      admin: { ...ACTIVE, role: 'admin', name: 'Admin' },
      manager: { ...ACTIVE, role: 'manager', name: 'Manager' },
      realSetter: { ...ACTIVE, role: 'setter', name: 'Setter' },
      closer: { ...ACTIVE, role: 'closer', name: 'Closer' },
      demo: {
        ...ACTIVE,
        role: 'setter',
        name: 'Demo',
        team: 'TEST',
        isTestAccount: true,
        testData: true,
      },
      pendingUser: {
        role: 'setter',
        name: 'Pending',
        approvalStatus: 'pending',
        approved: false,
        isActive: false,
        status: 'pending',
      },
      inactive: { ...ACTIVE, role: 'setter', name: 'Inactive', isActive: false },
      inactiveAdmin: { ...ACTIVE, role: 'admin', name: 'Inactive Admin', isActive: false },
      deletionRequested: {
        ...ACTIVE,
        role: 'setter',
        name: 'Deletion',
        status: 'deletion-requested',
        isActive: false,
      },
    };
    for (const [id, data] of Object.entries(users)) {
      await db.collection('users').doc(id).set(data);
    }

    await db.collection('territories').doc('TEST-appreview-territory').set({ userId: 'demo' });
    await db.collection('territories').doc('realTerritory').set({ userId: 'realSetter' });
    await db.collection('territories').doc('demo-real-territory').set({ userId: 'demo' });

    for (let n = 1; n <= 8; n += 1) {
      await db.collection('leads').doc(`TEST-appreview-lead-${n}`).set({
        status: 'new',
        assignedTo: 'demo',
        name: `Demo pin ${n}`,
      });
    }
    await db.collection('leads').doc('realLead').set({ status: 'assigned', assignedTo: 'realSetter' });
    await db.collection('leads').doc('claimedByOther').set({
      status: 'claimed',
      claimedBy: 'manager',
      assignedTo: 'manager',
    });
    await db.collection('leads').doc('unassignedInRealTerritory').set({
      status: 'new',
      territoryId: 'realTerritory',
    });
    await db.collection('leads').doc('territoryAddClaimed').set({
      status: 'new',
      territoryId: 'realTerritory',
    });
    await db.collection('leads').doc('territoryAddAssigned').set({
      status: 'new',
      territoryId: 'realTerritory',
    });
    await db.collection('leads').doc('unclaimedLead').set({ status: 'new' });
    await db.collection('leads').doc('demoTestClaimLead').set({
      status: 'new',
      testData: true,
      assignedTo: 'demo',
      territoryId: 'TEST-appreview-territory',
    });
    await db.collection('leads').doc('demoClaimOtherUid').set({
      status: 'new',
      testData: true,
      assignedTo: 'demo',
      territoryId: 'TEST-appreview-territory',
    });
    await db.collection('leads').doc('demoUnclaimOther').set({
      status: 'claimed',
      testData: true,
      assignedTo: 'demo',
      claimedBy: 'realSetter',
      territoryId: 'TEST-appreview-territory',
    });
    await db.collection('leads').doc('demoFlipTestData').set({
      status: 'new',
      testData: true,
      assignedTo: 'demo',
      territoryId: 'TEST-appreview-territory',
    });
    await db.collection('leads').doc('demoClaimRealTerritory').set({
      status: 'new',
      testData: true,
      assignedTo: 'demo',
      territoryId: 'demo-real-territory',
    });
    await db.collection('leads').doc('demoClaimUnassigned').set({
      status: 'new',
      testData: true,
      territoryId: 'TEST-appreview-territory',
    });
    await db.collection('leads').doc('claimAddAssigned').set({ status: 'new' });
    await db.collection('leads').doc('claimAddTerritory').set({ status: 'new' });
    await db.collection('leads').doc('managerAddClaimed').set({ status: 'new' });
    await db.collection('leads').doc('managerAddAssigned').set({ status: 'new' });
    await db.collection('leads').doc('adminAddClaimed').set({ status: 'new' });
    await db.collection('leads').doc('adminAddAssigned').set({ status: 'new' });
    await db.collection('leads').doc('adminKnockLead').set({ status: 'new' });
    await db.collection('leads').doc('placementLead').set({ status: 'new' });
    await db.collection('leads').doc('clearLead').set({
      status: 'new',
      hasEasterEgg: true,
      easterEggId: 'egg-1',
      assignedTo: 'realSetter',
    });
    await db.collection('leads').doc('inactiveLead').set({ status: 'assigned', assignedTo: 'inactive' });
    await db.collection('leads').doc('deletionLead').set({ status: 'assigned', assignedTo: 'deletionRequested' });
    await db.collection('leads').doc('strangerLead').set({ status: 'new' });
    await db.collection('leads').doc('adminDeleteLead').set({ status: 'new' });
    await db.collection('leads').doc('inactiveAdminDeleteLead').set({ status: 'new' });

    await db.collection('homeowners').doc('h1').set({ geohash: 'dr5regw3p' });
    await db.collection('homeowners').doc('h2').set({ geohash: 'dr5regw3q' });
    await db.collection('dispositions').doc('not-home').set({ label: 'Not Home' });
    await db.collection('adminSettings').doc('global').set({
      notificationWebhook: 'https://example.invalid/webhook/not-a-secret',
    });
    await db.collection('easterEggs').doc('egg-1').set({ active: true });
    await db.collection('easterEggs').doc('egg-win').set({ active: true });
    await db.collection('disposition_history').doc('hist-seed').set({ userId: 'admin' });
    await db.collection('userGoals').doc('goal-setter').set({ uid: 'realSetter' });
  });
}

function cases(): RuleCase[] {
  const lead = (id: string) => (db: Firestore) => db.collection('leads').doc(id);
  const homeowners = (limit?: number) => (db: Firestore) => {
    let query = db.collection('homeowners').orderBy('geohash').startAt('a').endAt('z');
    if (limit != null) query = query.limit(limit);
    return query.get();
  };
  return [
    { id: 'demo own user', uid: 'demo', run: (db) => db.collection('users').doc('demo').get(), expectTight: 'allow', exists: true },
    { id: 'demo other user', uid: 'demo', run: (db) => db.collection('users').doc('realSetter').get(), expectTight: 'deny' },
    { id: 'demo list users', uid: 'demo', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'demo read own lead', uid: 'demo', run: (db) => lead('TEST-appreview-lead-1')(db).get(), expectTight: 'allow', exists: true },
    { id: 'demo query assigned leads', uid: 'demo', run: (db) => db.collection('leads').where('assignedTo', '==', 'demo').get(), expectTight: 'allow' },
    { id: 'demo read real lead', uid: 'demo', run: (db) => lead('realLead')(db).get(), expectTight: 'deny' },
    { id: 'demo read own territory', uid: 'demo', run: (db) => db.collection('territories').doc('TEST-appreview-territory').get(), expectTight: 'allow' },
    { id: 'demo homeowners', uid: 'demo', run: homeowners(500), expectTight: 'deny' },
    { id: 'demo adminSettings', uid: 'demo', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },
    { id: 'demo dispositions', uid: 'demo', run: (db) => db.collection('dispositions').doc('not-home').get(), expectTight: 'allow' },
    { id: 'demo easter egg', uid: 'demo', run: (db) => db.collection('easterEggs').doc('egg-1').get(), expectTight: 'deny' },
    { id: 'demo claims and unclaims own TEST lead', uid: 'demo', run: async (db) => {
      await lead('demoTestClaimLead')(db).update({ status: 'claimed', claimedBy: 'demo', claimedAt: new Date() });
      await lead('demoTestClaimLead')(db).update({ status: 'unclaimed', claimedBy: null, claimedAt: null });
    }, expectTight: 'allow' },
    { id: 'demo claims real lead', uid: 'demo', run: (db) => lead('realLead')(db).update({ status: 'claimed', claimedBy: 'demo', claimedAt: new Date() }), expectTight: 'deny' },
    { id: 'demo claims TEST lead for another uid', uid: 'demo', run: (db) => lead('demoClaimOtherUid')(db).update({ status: 'claimed', claimedBy: 'realSetter', claimedAt: new Date() }), expectTight: 'deny' },
    { id: 'demo unclaims lead claimed by someone else', uid: 'demo', run: (db) => lead('demoUnclaimOther')(db).update({ status: 'unclaimed', claimedBy: null, claimedAt: null }), expectTight: 'deny' },
    { id: 'demo claim flips testData', uid: 'demo', run: (db) => lead('demoFlipTestData')(db).update({ status: 'claimed', claimedBy: 'demo', claimedAt: new Date(), testData: false }), expectTight: 'deny' },
    { id: 'demo claims lead in real territory', uid: 'demo', run: (db) => lead('demoClaimRealTerritory')(db).update({ status: 'claimed', claimedBy: 'demo', claimedAt: new Date() }), expectTight: 'deny' },
    { id: 'demo claims unassigned TEST lead', uid: 'demo', run: (db) => lead('demoClaimUnassigned')(db).update({ status: 'claimed', claimedBy: 'demo', claimedAt: new Date() }), expectTight: 'deny' },
    { id: 'demo knock own lead', uid: 'demo', run: (db) => lead('TEST-appreview-lead-2')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'allow' },
    { id: 'demo knock sets claimedBy to real rep', uid: 'demo', run: (db) => lead('TEST-appreview-lead-3')(db).update({ status: 'not-home', dispositionedAt: new Date(), claimedBy: 'realSetter' }), expectTight: 'deny' },
    { id: 'demo knock real lead', uid: 'demo', run: (db) => lead('realLead')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'deny' },
    { id: 'demo manual create', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo').set({ source: 'manually-added', setterId: 'demo', status: 'new' }), expectTight: 'deny' },
    { id: 'demo create test lead in own TEST territory', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-test').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'demo', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'allow' },
    { id: 'demo create test lead assigned to self', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-test-assigned').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'demo', assignedTo: 'demo', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'allow' },
    { id: 'demo create test lead assigned to other', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-test-assigned-other').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'demo', assignedTo: 'realSetter', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo create test lead with easter egg', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-test-egg').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'demo', territoryId: 'TEST-appreview-territory', hasEasterEgg: true, status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo create lead missing testData', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-notest').set({
      source: 'manually-added', claimedBy: 'demo', setterId: 'demo', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo create test lead in real territory', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-real-territory').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'demo', territoryId: 'demo-real-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo create test lead claimed by other', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-other-claim').set({
      source: 'manually-added', testData: true, claimedBy: 'realSetter', setterId: 'demo', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo create test lead setter other', uid: 'demo', run: (db) => db.collection('leads').doc('manual-demo-other-setter').set({
      source: 'manually-added', testData: true, claimedBy: 'demo', setterId: 'realSetter', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'demo cannot change role', uid: 'demo', run: (db) => db.collection('users').doc('demo').update({ role: 'admin' }), expectTight: 'deny' },
    { id: 'demo cannot change status', uid: 'demo', run: (db) => db.collection('users').doc('demo').update({ status: 'pending' }), expectTight: 'deny' },
    { id: 'demo cannot change approved', uid: 'demo', run: (db) => db.collection('users').doc('demo').update({ approved: false }), expectTight: 'deny' },
    { id: 'demo cannot change isActive', uid: 'demo', run: (db) => db.collection('users').doc('demo').update({ isActive: false }), expectTight: 'deny' },
    { id: 'demo cannot write real territory', uid: 'demo', run: (db) => db.collection('territories').doc('realTerritory').update({ userId: 'demo' }), expectTight: 'deny' },

    { id: 'setter own user', uid: 'realSetter', run: (db) => db.collection('users').doc('realSetter').get(), expectTight: 'allow' },
    { id: 'setter other user', uid: 'realSetter', run: (db) => db.collection('users').doc('closer').get(), expectTight: 'allow' },
    { id: 'setter list users', uid: 'realSetter', run: (db) => db.collection('users').get(), expectTight: 'allow' },
    { id: 'setter homeowners 500', uid: 'realSetter', run: homeowners(500), expectTight: 'allow' },
    { id: 'setter homeowners 501', uid: 'realSetter', run: homeowners(501), expectTight: 'deny' },
    { id: 'setter homeowners no limit', uid: 'realSetter', run: homeowners(), expectTight: 'deny' },
    { id: 'setter homeowners unordered', uid: 'realSetter', run: (db) => db.collection('homeowners').limit(500).get(), expectTight: 'deny' },
    { id: 'setter homeowners other order', uid: 'realSetter', run: (db) => db.collection('homeowners').orderBy('name').limit(500).get(), expectTight: 'deny' },
    { id: 'setter homeowner get', uid: 'realSetter', run: (db) => db.collection('homeowners').doc('h1').get(), expectTight: 'deny' },
    { id: 'setter read own lead', uid: 'realSetter', run: (db) => lead('realLead')(db).get(), expectTight: 'allow' },
    { id: 'setter update own lead', uid: 'realSetter', run: (db) => lead('realLead')(db).update({ notes: 'follow up' }), expectTight: 'allow' },
    { id: 'setter claim unclaimed', uid: 'realSetter', run: (db) => lead('unclaimedLead')(db).update({ claimedBy: 'realSetter', claimedAt: new Date(), status: 'claimed' }), expectTight: 'allow' },
    { id: 'setter claim adds assignedTo', uid: 'realSetter', run: (db) => lead('claimAddAssigned')(db).update({ claimedBy: 'realSetter', claimedAt: new Date(), status: 'claimed', assignedTo: 'realSetter' }), expectTight: 'deny' },
    { id: 'setter claim adds territoryId', uid: 'realSetter', run: (db) => lead('claimAddTerritory')(db).update({ claimedBy: 'realSetter', claimedAt: new Date(), status: 'claimed', territoryId: 'realTerritory' }), expectTight: 'deny' },
    { id: 'setter knock in territory', uid: 'realSetter', run: (db) => lead('unassignedInRealTerritory')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'allow' },
    { id: 'setter territory knock adds claimedBy', uid: 'realSetter', run: (db) => lead('territoryAddClaimed')(db).update({ status: 'not-home', dispositionedAt: new Date(), claimedBy: 'manager' }), expectTight: 'deny' },
    { id: 'setter territory knock adds assignedTo', uid: 'realSetter', run: (db) => lead('territoryAddAssigned')(db).update({ status: 'not-home', dispositionedAt: new Date(), assignedTo: 'realSetter' }), expectTight: 'deny' },
    { id: 'setter knock outside territory', uid: 'realSetter', run: (db) => lead('claimedByOther')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'deny' },
    { id: 'setter manual create', uid: 'realSetter', run: (db) => db.collection('leads').doc('manual-setter').set({ source: 'manually-added', setterId: 'realSetter', status: 'new' }), expectTight: 'allow' },
    { id: 'setter manual create with testData', uid: 'realSetter', run: (db) => db.collection('leads').doc('manual-setter-testdata').set({
      source: 'manually-added', testData: true, claimedBy: 'realSetter', setterId: 'realSetter', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'allow' },
    { id: 'setter nonmanual create with testData', uid: 'realSetter', run: (db) => db.collection('leads').doc('setter-testdata-only').set({
      testData: true, claimedBy: 'realSetter', setterId: 'realSetter', territoryId: 'TEST-appreview-territory', status: 'new',
    }), expectTight: 'deny' },
    { id: 'setter history create', uid: 'realSetter', run: (db) => db.collection('disposition_history').doc('hist-setter').set({ userId: 'realSetter' }), expectTight: 'allow' },
    { id: 'setter adminSettings', uid: 'realSetter', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'allow' },
    { id: 'setter dispositions', uid: 'realSetter', run: (db) => db.collection('dispositions').get(), expectTight: 'allow' },
    { id: 'setter own territory', uid: 'realSetter', run: (db) => db.collection('territories').doc('realTerritory').get(), expectTight: 'allow' },
    { id: 'setter other territory', uid: 'realSetter', run: (db) => db.collection('territories').doc('TEST-appreview-territory').get(), expectTight: 'deny' },
    { id: 'setter all leads', uid: 'realSetter', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'setter easter egg read', uid: 'realSetter', run: (db) => db.collection('easterEggs').doc('egg-1').get(), expectTight: 'allow' },
    { id: 'setter easter egg clear', uid: 'realSetter', run: (db) => lead('clearLead')(db).update({ hasEasterEgg: false, easterEggId: null }), expectTight: 'allow' },
    { id: 'setter easter egg win', uid: 'realSetter', run: (db) => db.collection('easterEggs').doc('egg-win').update({ wonBy: 'realSetter', currentWinners: ['realSetter'], active: false }), expectTight: 'allow' },
    { id: 'setter own session', uid: 'realSetter', run: (db) => db.collection('userSessions').doc('realSetter').set({ step: 1 }), expectTight: 'allow' },
    { id: 'setter own goal', uid: 'realSetter', run: (db) => db.collection('userGoals').doc('goal-setter').get(), expectTight: 'allow' },
    { id: 'setter lead delete', uid: 'realSetter', run: (db) => lead('adminDeleteLead')(db).delete(), expectTight: 'deny' },

    { id: 'closer list users', uid: 'closer', run: (db) => db.collection('users').get(), expectTight: 'allow' },
    { id: 'closer homeowners', uid: 'closer', run: homeowners(500), expectTight: 'allow' },
    { id: 'closer dispositions', uid: 'closer', run: (db) => db.collection('dispositions').doc('not-home').get(), expectTight: 'allow' },
    { id: 'closer adminSettings', uid: 'closer', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'allow' },
    { id: 'closer all leads', uid: 'closer', run: (db) => db.collection('leads').get(), expectTight: 'deny' },

    { id: 'manager list users', uid: 'manager', run: (db) => db.collection('users').get(), expectTight: 'allow' },
    { id: 'manager get user', uid: 'manager', run: (db) => db.collection('users').doc('realSetter').get(), expectTight: 'allow' },
    { id: 'manager all leads', uid: 'manager', run: (db) => db.collection('leads').get(), expectTight: 'allow' },
    { id: 'manager homeowners', uid: 'manager', run: homeowners(500), expectTight: 'allow' },
    { id: 'manager place egg', uid: 'manager', run: (db) => lead('placementLead')(db).update({ hasEasterEgg: true, easterEggId: 'egg-1' }), expectTight: 'allow' },
    { id: 'manager knock other lead', uid: 'manager', run: (db) => lead('claimedByOther')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'allow' },
    { id: 'manager knock stranger', uid: 'manager', run: (db) => lead('strangerLead')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'allow' },
    { id: 'manager knock adds claimedBy', uid: 'manager', run: (db) => lead('managerAddClaimed')(db).update({ status: 'not-home', dispositionedAt: new Date(), claimedBy: 'realSetter' }), expectTight: 'deny' },
    { id: 'manager knock adds assignedTo', uid: 'manager', run: (db) => lead('managerAddAssigned')(db).update({ status: 'not-home', dispositionedAt: new Date(), assignedTo: 'manager' }), expectTight: 'deny' },
    { id: 'manager lead delete', uid: 'manager', run: (db) => lead('adminDeleteLead')(db).delete(), expectTight: 'deny' },
    { id: 'manager other territory', uid: 'manager', run: (db) => db.collection('territories').doc('realTerritory').get(), expectTight: 'deny' },
    { id: 'manager user write', uid: 'manager', run: (db) => db.collection('users').doc('nope').set({ role: 'setter' }), expectTight: 'deny' },

    { id: 'admin user write', uid: 'admin', run: (db) => db.collection('users').doc('created-by-admin').set({ role: 'setter', name: 'Created', ...ACTIVE }), expectTight: 'allow' },
    { id: 'admin territory write', uid: 'admin', run: (db) => db.collection('territories').doc('admin-made').set({ userId: 'realSetter' }), expectTight: 'allow' },
    { id: 'admin knock status only', uid: 'admin', run: (db) => lead('adminKnockLead')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'allow' },
    { id: 'admin knock adds claimedBy', uid: 'admin', run: (db) => lead('adminAddClaimed')(db).update({ status: 'not-home', dispositionedAt: new Date(), claimedBy: 'realSetter' }), expectTight: 'allow' },
    { id: 'admin knock adds assignedTo', uid: 'admin', run: (db) => lead('adminAddAssigned')(db).update({ status: 'not-home', dispositionedAt: new Date(), assignedTo: 'realSetter' }), expectTight: 'allow' },
    { id: 'admin lead delete', uid: 'admin', run: (db) => lead('adminDeleteLead')(db).delete(), expectTight: 'allow' },
    { id: 'admin history read', uid: 'admin', run: (db) => db.collection('disposition_history').doc('hist-seed').get(), expectTight: 'allow' },
    { id: 'admin all leads', uid: 'admin', run: (db) => db.collection('leads').get(), expectTight: 'allow' },
    { id: 'admin homeowner get', uid: 'admin', run: (db) => db.collection('homeowners').doc('h1').get(), expectTight: 'deny' },

    { id: 'pending own user', uid: 'pendingUser', run: (db) => db.collection('users').doc('pendingUser').get(), expectTight: 'allow', exists: true },
    { id: 'pending list users', uid: 'pendingUser', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'pending list leads', uid: 'pendingUser', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'pending homeowners', uid: 'pendingUser', run: homeowners(500), expectTight: 'deny' },
    { id: 'pending dispositions', uid: 'pendingUser', run: (db) => db.collection('dispositions').get(), expectTight: 'deny' },
    { id: 'pending adminSettings', uid: 'pendingUser', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },
    { id: 'pending manual create', uid: 'pendingUser', run: (db) => db.collection('leads').doc('manual-pending').set({ source: 'manually-added', setterId: 'pendingUser', status: 'new' }), expectTight: 'deny' },
    { id: 'pending easter egg', uid: 'pendingUser', run: (db) => db.collection('easterEggs').doc('egg-1').get(), expectTight: 'deny' },

    { id: 'nodoc own user', uid: 'noDoc', run: (db) => db.collection('users').doc('noDoc').get(), expectTight: 'allow', exists: false },
    { id: 'nodoc list users', uid: 'noDoc', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'nodoc list leads', uid: 'noDoc', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'nodoc homeowners', uid: 'noDoc', run: homeowners(500), expectTight: 'deny' },
    { id: 'nodoc dispositions', uid: 'noDoc', run: (db) => db.collection('dispositions').get(), expectTight: 'deny' },
    { id: 'nodoc adminSettings', uid: 'noDoc', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },
    { id: 'nodoc manual create', uid: 'noDoc', run: (db) => db.collection('leads').doc('manual-nodoc').set({ source: 'manually-added', setterId: 'noDoc', status: 'new' }), expectTight: 'deny' },

    { id: 'inactive own user', uid: 'inactive', run: (db) => db.collection('users').doc('inactive').get(), expectTight: 'allow', exists: true },
    { id: 'inactive list users', uid: 'inactive', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'inactive list leads', uid: 'inactive', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'inactive homeowners', uid: 'inactive', run: homeowners(500), expectTight: 'deny' },
    { id: 'inactive dispositions', uid: 'inactive', run: (db) => db.collection('dispositions').get(), expectTight: 'deny' },
    { id: 'inactive adminSettings', uid: 'inactive', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },
    { id: 'inactive update own lead', uid: 'inactive', run: (db) => lead('inactiveLead')(db).update({ notes: 'nope' }), expectTight: 'deny' },
    { id: 'inactive knock own lead', uid: 'inactive', run: (db) => lead('inactiveLead')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'deny' },
    { id: 'inactive history create', uid: 'inactive', run: (db) => db.collection('disposition_history').doc('hist-inactive').set({ userId: 'inactive' }), expectTight: 'deny' },

    { id: 'deletion own user', uid: 'deletionRequested', run: (db) => db.collection('users').doc('deletionRequested').get(), expectTight: 'allow', exists: true },
    { id: 'deletion list users', uid: 'deletionRequested', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'deletion update own lead', uid: 'deletionRequested', run: (db) => lead('deletionLead')(db).update({ notes: 'nope' }), expectTight: 'deny' },
    { id: 'deletion knock own lead', uid: 'deletionRequested', run: (db) => lead('deletionLead')(db).update({ status: 'not-home', dispositionedAt: new Date() }), expectTight: 'deny' },
    { id: 'deletion history create', uid: 'deletionRequested', run: (db) => db.collection('disposition_history').doc('hist-deletion').set({ userId: 'deletionRequested' }), expectTight: 'deny' },
    { id: 'deletion homeowners', uid: 'deletionRequested', run: homeowners(500), expectTight: 'deny' },
    { id: 'deletion dispositions', uid: 'deletionRequested', run: (db) => db.collection('dispositions').doc('not-home').get(), expectTight: 'deny' },
    { id: 'deletion adminSettings', uid: 'deletionRequested', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },

    { id: 'inactive admin lead delete', uid: 'inactiveAdmin', run: (db) => lead('inactiveAdminDeleteLead')(db).delete(), expectTight: 'deny' },
    { id: 'inactive admin user write', uid: 'inactiveAdmin', run: (db) => db.collection('users').doc('should-not').set({ role: 'setter' }), expectTight: 'deny' },
    { id: 'inactive admin history read', uid: 'inactiveAdmin', run: (db) => db.collection('disposition_history').doc('hist-seed').get(), expectTight: 'deny' },
    { id: 'inactive admin all leads', uid: 'inactiveAdmin', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'inactive admin own user', uid: 'inactiveAdmin', run: (db) => db.collection('users').doc('inactiveAdmin').get(), expectTight: 'allow' },

    { id: 'anon own user', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('users').doc('anon').get(), expectTight: 'deny' },
    { id: 'anon list users', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('users').get(), expectTight: 'deny' },
    { id: 'anon list leads', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('leads').get(), expectTight: 'deny' },
    { id: 'anon homeowners', uid: 'anon', provider: 'anonymous', run: homeowners(500), expectTight: 'deny' },
    { id: 'anon dispositions', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('dispositions').get(), expectTight: 'deny' },
    { id: 'anon adminSettings', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('adminSettings').doc('global').get(), expectTight: 'deny' },
    { id: 'anon easter egg', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('easterEggs').doc('egg-1').get(), expectTight: 'deny' },
    { id: 'anon history create', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('disposition_history').doc('hist-anon').set({ userId: 'anon' }), expectTight: 'deny' },
    { id: 'anon session', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('userSessions').doc('anon').set({ step: 1 }), expectTight: 'deny' },
    { id: 'anon territory', uid: 'anon', provider: 'anonymous', run: (db) => db.collection('territories').doc('realTerritory').get(), expectTight: 'deny' },

    // fieldSyncReports stays client-closed (default deny). No match block.
    { id: 'setter fieldSyncReports create', uid: 'realSetter', run: (db) => db.collection('fieldSyncReports').doc('x').set({ reasonCode: 'other' }), expectTight: 'deny' },
    { id: 'setter fieldSyncReports get', uid: 'realSetter', run: (db) => db.collection('fieldSyncReports').doc('x').get(), expectTight: 'deny' },
    { id: 'setter fieldSyncReports list', uid: 'realSetter', run: (db) => db.collection('fieldSyncReports').get(), expectTight: 'deny' },
    { id: 'admin fieldSyncReports create', uid: 'admin', run: (db) => db.collection('fieldSyncReports').doc('x').set({ reasonCode: 'other' }), expectTight: 'deny' },
    { id: 'admin fieldSyncReports get', uid: 'admin', run: (db) => db.collection('fieldSyncReports').doc('x').get(), expectTight: 'deny' },
    { id: 'admin fieldSyncReports list', uid: 'admin', run: (db) => db.collection('fieldSyncReports').get(), expectTight: 'deny' },

    // fieldDispoReceipts stays client-closed (default deny). No match block.
    { id: 'setter fieldDispoReceipts get', uid: 'realSetter', run: (db) => db.collection('fieldDispoReceipts').doc('x').get(), expectTight: 'deny' },
    { id: 'setter fieldDispoReceipts create', uid: 'realSetter', run: (db) => db.collection('fieldDispoReceipts').doc('x').set({ uid: 'realSetter' }), expectTight: 'deny' },
    { id: 'admin fieldDispoReceipts get', uid: 'admin', run: (db) => db.collection('fieldDispoReceipts').doc('x').get(), expectTight: 'deny' },
    { id: 'admin fieldDispoReceipts create', uid: 'admin', run: (db) => db.collection('fieldDispoReceipts').doc('x').set({ uid: 'admin' }), expectTight: 'deny' },
  ];
}

async function open(projectId: string, rules: string): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
}

describe('firestore rules', { concurrency: 1 }, () => {
  it('matches the tightened matrix and never allows what the deployed rules deny', async () => {
    const deployed = await open('demo-rules-deployed', DEPLOYED);
    const tight = await open('demo-rules-tight', TIGHT);
    const deployedClients = new Map<string, Firestore>();
    const tightClients = new Map<string, Firestore>();
    try {
      await seed(deployed);
      await seed(tight);

      const mismatches: string[] = [];
      const loosened: string[] = [];
      const allowedExceptions: string[] = [];
      // Deployed rules have no TEST claim/unclaim. This is the only intended loosening.
      const intendedException = 'demo claims and unclaims own TEST lead';
      for (const ruleCase of cases()) {
        const provider = ruleCase.provider ?? 'password';
        const deployedResult = client(deployed, ruleCase.uid, provider, deployedClients);
        const tightResult = client(tight, ruleCase.uid, provider, tightClients);
        const before = await verdict(ruleCase.run(deployedResult));
        let after: Outcome;
        let value: unknown;
        try {
          value = await ruleCase.run(tightResult);
          after = 'allow';
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
          if (!code.includes('permission-denied')) throw error;
          after = 'deny';
        }

        if (after !== ruleCase.expectTight) {
          mismatches.push(`${ruleCase.id}: expected ${ruleCase.expectTight}, got ${after} (deployed ${before})`);
        }
        if (before === 'deny' && after === 'allow') {
          const line = `${ruleCase.id}: deployed denied, tightened allowed`;
          if (ruleCase.id === intendedException && ruleCase.uid === 'demo') {
            allowedExceptions.push(line);
          } else {
            loosened.push(line);
          }
        }
        if (after === 'allow' && ruleCase.exists != null) {
          const snap = value as { exists?: boolean };
          assert.equal(snap.exists, ruleCase.exists, ruleCase.id);
        }
      }

      console.log(`rules cases: ${cases().length}`);
      console.log(`tight mismatches: ${mismatches.length}`);
      console.log(`tighten-only violations: ${loosened.length}`);
      console.log(`allowed exceptions: ${allowedExceptions.length}`);
      for (const line of allowedExceptions) {
        console.log(`allowed exception: ${line} (TEST account claim/unclaim of an assigned testData lead in the caller's TEST territory)`);
      }
      assert.deepEqual(mismatches, []);
      assert.deepEqual(loosened, []);
      assert.deepEqual(allowedExceptions, [
        `${intendedException}: deployed denied, tightened allowed`,
      ]);
    } finally {
      await deployed.cleanup();
      await tight.cleanup();
    }
  });

  it('exposes request.query.orderBy as a field-to-direction map', async () => {
    const env = await open('demo-orderby-probe', `
      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /homeowners/{id} {
            allow list: if request.query.orderBy['geohash'] == 'ASC';
          }
        }
      }
    `);
    try {
      await env.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('homeowners').doc('h').set({ geohash: 'abc', name: 'n' });
      });
      const db = env.authenticatedContext('u', token('password')).firestore();
      const check = async (run: () => Promise<unknown>): Promise<Outcome> => {
        try {
          await run();
          return 'allow';
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code || '')
            : '';
          if (!code.includes('permission-denied')) throw error;
          return 'deny';
        }
      };
      const ordered = await check(() => db.collection('homeowners').orderBy('geohash').limit(1).get());
      const unordered = await check(() => db.collection('homeowners').limit(1).get());
      const descending = await check(() => db.collection('homeowners').orderBy('geohash', 'desc').limit(1).get());
      const other = await check(() => db.collection('homeowners').orderBy('name').limit(1).get());
      console.log(`request.query.orderBy probe: geohash ASC ${ordered}, unordered ${unordered}, desc ${descending}, other ${other}`);
      assert.equal(ordered, 'allow');
      assert.equal(unordered, 'deny');
      assert.equal(descending, 'deny');
      assert.equal(other, 'deny');
    } finally {
      await env.cleanup();
    }
    void assertFails;
  });
});
