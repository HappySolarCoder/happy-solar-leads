import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
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
const LIVE = readFileSync(new URL('./fixtures/live-8533ae5.rules', import.meta.url), 'utf8');
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

const STORAGE_PHOTO_URL = 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0395385938.firebasestorage.app/o/roof.jpg?alt=media&token=abc';
const STORED_PHOTO_AT = new Date('2026-10-01T12:00:00Z');
const NEW_PHOTO_AT = new Date('2026-10-25T16:30:00Z');
const URL_HOST = 'https://example.com/';
const URL_2048 = `${URL_HOST}${'a'.repeat(2048 - URL_HOST.length)}`;
const URL_2049 = `${URL_HOST}${'a'.repeat(2049 - URL_HOST.length)}`;

function storedPhoto(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `1720000000000-${String(n).padStart(9, '0')}`,
    url: STORAGE_PHOTO_URL,
    caption: '',
    type: 'roof',
    uploadedBy: 'manager',
    uploadedAt: STORED_PHOTO_AT,
    ...extra,
  };
}

function storedPhotos(count: number) {
  return Array.from({ length: count }, (_, n) => storedPhoto(n));
}

function addedPhoto(uid: string, extra: Record<string, unknown> = {}) {
  return {
    id: '1761364200000-abc123xyz',
    url: STORAGE_PHOTO_URL,
    caption: '',
    type: 'roof',
    uploadedBy: uid,
    uploadedAt: NEW_PHOTO_AT,
    ...extra,
  };
}

const CONTACT_SAVED = {
  name: 'Homeowner',
  address: '1 Main St',
  city: 'Buffalo',
  state: 'NY',
  zip: '14201',
  phone: '7165550100',
  email: 'home@example.com',
  estimatedBill: 150,
  notes: 'gate code 4',
};

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
    // Dispo-only branch fixtures (one lead per case: the matrix does not reseed).
    const priorDispo = {
      status: 'go-back', goBackScheduledDate: new Date('2026-10-20T00:00:00Z'), goBackScheduledTime: '10:00', goBackNotes: 'old',
      goBackScheduledBy: 'manager', objectionType: 'need-to-think', objectionNotes: 'old',
      objectionRecordedAt: new Date('2026-10-19T00:00:00Z'), objectionRecordedBy: 'manager',
    };
    for (const id of ['dispoPriorPin1', 'dispoPriorPin2']) {
      await db.collection('leads').doc(id).set({ ...priorDispo, territoryId: 'realTerritory' });
    }
    await db.collection('leads').doc('dispoPriorStranger').set({ ...priorDispo });
    for (const id of ['dispoFreshPin1', 'dispoFreshPin2', 'dispoFreshPin3', 'dispoFreshPin4']) {
      await db.collection('leads').doc(id).set({ status: 'new', territoryId: 'realTerritory' });
    }
    await db.collection('leads').doc('dispoNotedPin').set({ status: 'new', territoryId: 'realTerritory', notes: 'gate code 4' });
    await db.collection('leads').doc('dispoClaimedPin').set({ status: 'claimed', territoryId: 'realTerritory', claimedBy: 'manager' });
    await db.collection('leads').doc('dispoFullDoc').set({ status: 'new', name: 'Homeowner' });
    await db.collection('leads').doc('dispoFreshStranger').set({ status: 'new' });
    const bareLead = (id: string, extra: Record<string, unknown> = {}) =>
      db.collection('leads').doc(id).set({ status: 'new', ...extra });
    await bareLead('gpsClaimed', { status: 'claimed', claimedBy: 'realSetter' });
    await bareLead('gpsAssigned', { status: 'assigned', assignedTo: 'realSetter' });
    await bareLead('gpsTerritory', { territoryId: 'realTerritory' });
    await bareLead('gpsNone');
    await bareLead('gpsFar');
    await bareLead('gpsBadReason');
    await bareLead('gpsBadType');
    await bareLead('gpsFourth');
    await bareLead('gpsOutOfArea');
    await bareLead('ownerGpsBad', { status: 'claimed', claimedBy: 'realSetter' });
    await bareLead('ownerGpsOk', { status: 'claimed', claimedBy: 'realSetter' });
    await bareLead('ownerGpsClear', {
      status: 'claimed', claimedBy: 'realSetter',
      gpsVerified: false, gpsUnverifiedReason: 'stale', gpsDistanceM: 40,
    });
    await bareLead('managerGpsClear', {
      territoryId: 'realTerritory',
      gpsVerified: false, gpsUnverifiedReason: 'too_far', gpsDistanceM: 80,
    });
    await bareLead('notesLongGoBack', { territoryId: 'realTerritory' });
    await bareLead('notesLongObjection', { territoryId: 'realTerritory' });
    await bareLead('notesCapGoBack', { territoryId: 'realTerritory' });
    const budgetPins: Record<string, Record<string, unknown>> = {
      claimed: { status: 'claimed', claimedBy: 'closer', territoryId: 'realTerritory' },
      assigned: { status: 'assigned', assignedTo: 'closer', territoryId: 'realTerritory' },
      manual: {
        status: 'claimed', claimedBy: 'closer', setterId: 'closer',
        source: 'manually-added', territoryId: 'realTerritory',
      },
    };
    for (const pin of Object.keys(budgetPins)) {
      for (const actor of ['territory-owner', 'manager']) {
        for (const kind of ['objection', 'go-back']) {
          for (const gps of ['deferred', 'flags']) {
            await bareLead(`budget-${pin}-${actor}-${kind}-${gps}`, budgetPins[pin]);
          }
        }
      }
    }
    await bareLead('gpsBadLat');
    await bareLead('gpsHugeDistance');
    await bareLead('photoFirstManager');
    await bareLead('photoFirstSetter', { territoryId: 'realTerritory' });
    await bareLead('photoAppend', { photos: [storedPhoto(1)] });
    await bareLead('photoFifty', { photos: storedPhotos(49) });
    await bareLead('photoTwo');
    await bareLead('photoOverwrite', { photos: [storedPhoto(1)] });
    await bareLead('photoEditOld', { photos: [storedPhoto(1), storedPhoto(2)] });
    await bareLead('photoReorder', { photos: [storedPhoto(0), storedPhoto(1), storedPhoto(2)] });
    await bareLead('photoSpoof', { territoryId: 'realTerritory' });
    await bareLead('photoBadType');
    await bareLead('photoLongUrl');
    await bareLead('photoLongCaption');
    await bareLead('photoCap', { photos: storedPhotos(50) });
    await bareLead('photoOutside');
    await bareLead('photoDelete', { photos: [storedPhoto(1)] });
    await bareLead('photoBadId');
    await bareLead('photoBadTime');
    await bareLead('photoExtra');
    await bareLead('photoNoCaption');
    await bareLead('photoCaption500');
    await bareLead('photoUrl2048');
    await bareLead('photoEmptyUrl');
    await bareLead('ownerPhotoLead', { status: 'assigned', assignedTo: 'realSetter', photos: [storedPhoto(0)] });
    const { email, ...contactWithoutEmail } = CONTACT_SAVED;
    void email;
    await bareLead('contactAllNine', contactWithoutEmail);
    await bareLead('contactRename', CONTACT_SAVED);
    await bareLead('contactPartialEmail', { name: 'Homeowner' });
    await bareLead('contactPartialPhone');
    await bareLead('contactPartialBill');
    await bareLead('contactBillCap');
    await bareLead('contactBillZero');
    await bareLead('contactMissingName');
    await bareLead('contactTerritoryPhone', { territoryId: 'realTerritory' });
    await bareLead('contactOutside');
    await bareLead('contactOverwriteEmail', { email: 'home@example.com' });
    await bareLead('contactOversizeEmail');
    await bareLead('contactNegativeBill');
    await bareLead('contactHugeBill');
    await bareLead('contactStringBill');
    await bareLead('contactDeletePhone', { phone: '7165550100' });
    const clearable = { phone: '7165550100', email: 'home@example.com', estimatedBill: 150, notes: 'gate code 4' };
    await bareLead('clearMgrEmail', clearable);
    await bareLead('clearMgrBill', clearable);
    await bareLead('clearMgrNotes', clearable);
    await bareLead('clearSetPhone', { ...clearable, territoryId: 'realTerritory', claimedBy: 'manager' });
    await bareLead('clearSetEmail', { ...clearable, territoryId: 'realTerritory', claimedBy: 'manager' });
    await bareLead('clearSetBill', { ...clearable, territoryId: 'realTerritory', claimedBy: 'manager' });
    await bareLead('clearSetNotes', { ...clearable, territoryId: 'realTerritory', claimedBy: 'manager' });
    await bareLead('clearOutside', { ...clearable, claimedBy: 'manager' });
    await bareLead('clearDemoOutside', { ...clearable, claimedBy: 'manager' });
    await bareLead('clearDemoTerritory', { ...clearable, territoryId: 'demo-real-territory', claimedBy: 'manager' });
    await bareLead('contactEmailAndSetter');
    await bareLead('staffAssignLead', { name: 'Homeowner' });
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
  const at = new Date('2026-10-25T16:30:00Z');
  const hist = (uid: string) => [{ disposition: 'Go Back', timestamp: at, userId: uid, userName: uid }];
  const goBack = (uid: string, extra: Record<string, unknown> = {}) => ({
    status: 'go-back', disposition: 'Go Back', dispositionedAt: at, dispositionHistory: hist(uid),
    goBackScheduledDate: new Date('2026-10-28T00:00:00Z'), goBackScheduledTime: '14:30', goBackNotes: 'Come back after 5',
    goBackScheduledBy: uid, ...extra,
  });
  const objection = (uid: string) => ({
    status: 'not-interested', dispositionedAt: at, dispositionHistory: hist(uid), objectionType: 'too-expensive',
    objectionNotes: '', objectionRecordedAt: at, objectionRecordedBy: uid,
  });
  const deferredGps = {
    knockGpsLat: 42.9,
    knockGpsLng: -78.8,
    knockGpsAccuracy: 12,
    knockGpsTimestamp: at,
    knockDistanceFromAddress: 40,
  };
  const flagGps = { gpsVerified: false, gpsUnverifiedReason: 'too_far', gpsDistanceM: 40 };
  const budgetRows: RuleCase[] = [];
  for (const pin of ['claimed', 'assigned', 'manual']) {
    for (const [actor, uid, slug] of [
      ['territory owner', 'realSetter', 'territory-owner'],
      ['manager', 'manager', 'manager'],
    ] as const) {
      for (const kind of ['objection', 'go-back'] as const) {
        for (const [gpsName, slugGps, extra] of [
          ['deferred knock GPS', 'deferred', deferredGps],
          ['deferred knock GPS and gps flags', 'flags', { ...deferredGps, ...flagGps }],
        ] as const) {
          const payload = kind === 'objection' ? { ...objection(uid), ...extra } : goBack(uid, extra);
          budgetRows.push({
            id: `budget ${actor} ${kind} on ${pin} pin with ${gpsName}`,
            uid,
            run: (db) => lead(`budget-${pin}-${slug}-${kind}-${slugGps}`)(db).update(payload),
            expectTight: 'allow',
          });
        }
      }
    }
  }
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
    { id: 'setter Go Back on prior territory pin', uid: 'realSetter', run: (db) => lead('dispoPriorPin1')(db).update(goBack('realSetter')), expectTight: 'allow' },
    { id: 'manager objection on prior lead', uid: 'manager', run: (db) => lead('dispoPriorStranger')(db).update(objection('manager')), expectTight: 'allow' },
    { id: 'setter Go Back oversize goBackNotes', uid: 'realSetter', run: (db) => lead('dispoPriorPin2')(db).update(goBack('realSetter', { goBackNotes: 'y'.repeat(10001) })), expectTight: 'deny' },
    { id: 'setter Go Back note of 2001 on a fresh pin', uid: 'realSetter', run: (db) => lead('notesLongGoBack')(db).update(goBack('realSetter', { goBackNotes: 'y'.repeat(2001) })), expectTight: 'allow' },
    { id: 'setter objection note of 10000 on a fresh pin', uid: 'realSetter', run: (db) => lead('notesLongObjection')(db).update({ ...objection('realSetter'), objectionNotes: 'n'.repeat(10000) }), expectTight: 'allow' },
    { id: 'setter Go Back note of 10001 on a fresh pin', uid: 'realSetter', run: (db) => lead('notesCapGoBack')(db).update(goBack('realSetter', { goBackNotes: 'y'.repeat(10001) })), expectTight: 'deny' },
    { id: 'setter Go Back spoofed goBackScheduledBy', uid: 'realSetter', run: (db) => lead('dispoFreshPin1')(db).update(goBack('realSetter', { goBackScheduledBy: 'manager' })), expectTight: 'deny' },
    { id: 'setter notes-only on territory pin without notes', uid: 'realSetter', run: (db) => lead('dispoFreshPin2')(db).update({ notes: 'dog in yard' }), expectTight: 'allow' },
    { id: 'setter oversize notes on territory pin', uid: 'realSetter', run: (db) => lead('dispoFreshPin3')(db).update({ notes: 'n'.repeat(10001) }), expectTight: 'deny' },
    { id: 'setter overwrites existing notes on territory pin', uid: 'realSetter', run: (db) => lead('dispoNotedPin')(db).update({ notes: 'replaced' }), expectTight: 'deny' },
    { id: 'manager first photo on non-owned lead', uid: 'manager', run: (db) => lead('photoFirstManager')(db).update({ photos: [addedPhoto('manager')] }), expectTight: 'allow' },
    { id: 'setter first photo on territory pin', uid: 'realSetter', run: (db) => lead('photoFirstSetter')(db).update({ photos: [addedPhoto('realSetter', { type: 'electrical', url: 'https://example.com/panel.jpg', caption: 'panel' })] }), expectTight: 'allow' },
    { id: 'manager appends one photo on non-owned lead', uid: 'manager', run: (db) => lead('photoAppend')(db).update({ photos: [storedPhoto(1), addedPhoto('manager', { type: 'meter', caption: 'meter closeup' })] }), expectTight: 'allow' },
    { id: 'manager adds the 50th photo on a non-owned lead', uid: 'manager', run: (db) => lead('photoFifty')(db).update({ photos: [...storedPhotos(49), addedPhoto('manager')] }), expectTight: 'allow' },
    { id: 'manager photo caption at 500 characters', uid: 'manager', run: (db) => lead('photoCaption500')(db).update({ photos: [addedPhoto('manager', { type: 'roofing', caption: 'c'.repeat(500) })] }), expectTight: 'allow' },
    { id: 'manager photo url at 2048 characters', uid: 'manager', run: (db) => lead('photoUrl2048')(db).update({ photos: [addedPhoto('manager', { type: 'other', url: URL_2048 })] }), expectTight: 'allow' },
    { id: 'manager adds two photos at once', uid: 'manager', run: (db) => lead('photoTwo')(db).update({ photos: [addedPhoto('manager'), addedPhoto('manager', { id: '1761364200001-def456uvw' })] }), expectTight: 'deny' },
    { id: 'manager overwrites photos on non-owned lead', uid: 'manager', run: (db) => lead('photoOverwrite')(db).update({ photos: [addedPhoto('manager')] }), expectTight: 'deny' },
    { id: 'manager photo append changes an existing photo', uid: 'manager', run: (db) => lead('photoEditOld')(db).update({ photos: [storedPhoto(1, { caption: 'changed' }), storedPhoto(2), addedPhoto('manager')] }), expectTight: 'deny' },
    { id: 'manager photo append reorders existing photos', uid: 'manager', run: (db) => lead('photoReorder')(db).update({ photos: [storedPhoto(0), storedPhoto(2), storedPhoto(1), addedPhoto('manager')] }), expectTight: 'deny' },
    { id: 'setter photo uploadedBy is not the caller', uid: 'realSetter', run: (db) => lead('photoSpoof')(db).update({ photos: [addedPhoto('manager')] }), expectTight: 'deny' },
    { id: 'manager photo type is not allowed', uid: 'manager', run: (db) => lead('photoBadType')(db).update({ photos: [addedPhoto('manager', { type: 'house' })] }), expectTight: 'deny' },
    { id: 'manager photo url over 2048 characters', uid: 'manager', run: (db) => lead('photoLongUrl')(db).update({ photos: [addedPhoto('manager', { url: URL_2049 })] }), expectTight: 'deny' },
    { id: 'manager photo caption over 500 characters', uid: 'manager', run: (db) => lead('photoLongCaption')(db).update({ photos: [addedPhoto('manager', { caption: 'c'.repeat(501) })] }), expectTight: 'deny' },
    { id: 'manager adds a 51st photo', uid: 'manager', run: (db) => lead('photoCap')(db).update({ photos: [...storedPhotos(50), addedPhoto('manager')] }), expectTight: 'deny' },
    { id: 'manager photo id is not the client shape', uid: 'manager', run: (db) => lead('photoBadId')(db).update({ photos: [addedPhoto('manager', { id: 'p1' })] }), expectTight: 'deny' },
    { id: 'manager photo uploadedAt is not a timestamp', uid: 'manager', run: (db) => lead('photoBadTime')(db).update({ photos: [addedPhoto('manager', { uploadedAt: '2026-10-25T16:30:00Z' })] }), expectTight: 'deny' },
    { id: 'manager photo has an extra field', uid: 'manager', run: (db) => lead('photoExtra')(db).update({ photos: [addedPhoto('manager', { source: 'street' })] }), expectTight: 'deny' },
    { id: 'manager photo is missing caption', uid: 'manager', run: (db) => lead('photoNoCaption')(db).update({ photos: [(() => { const { caption, ...rest } = addedPhoto('manager'); void caption; return rest; })()] }), expectTight: 'deny' },
    { id: 'manager photo url is empty', uid: 'manager', run: (db) => lead('photoEmptyUrl')(db).update({ photos: [addedPhoto('manager', { url: '' })] }), expectTight: 'deny' },
    { id: 'setter photo on lead outside territory', uid: 'realSetter', run: (db) => lead('photoOutside')(db).update({ photos: [addedPhoto('realSetter')] }), expectTight: 'deny' },
    { id: 'manager deletes photos on non-owned lead', uid: 'manager', run: (db) => lead('photoDelete')(db).update({ photos: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'setter replaces photos on own lead', uid: 'realSetter', run: (db) => lead('ownerPhotoLead')(db).update({ photos: [{ id: 'not-client-shape', url: 'https://example.com/replaced.jpg' }] }), expectTight: 'allow' },
    { id: 'manager sends all 9 contact fields with one new email', uid: 'manager', run: (db) => lead('contactAllNine')(db).update({ ...CONTACT_SAVED }), expectTight: 'allow' },
    { id: 'manager partial email on non-owned lead', uid: 'manager', run: (db) => lead('contactPartialEmail')(db).update({ email: 'home@example.com' }), expectTight: 'allow' },
    { id: 'manager partial phone on non-owned lead', uid: 'manager', run: (db) => lead('contactPartialPhone')(db).update({ phone: '7165550199' }), expectTight: 'allow' },
    { id: 'manager partial estimatedBill on non-owned lead', uid: 'manager', run: (db) => lead('contactPartialBill')(db).update({ estimatedBill: 180.5 }), expectTight: 'allow' },
    { id: 'manager estimatedBill at cap on non-owned lead', uid: 'manager', run: (db) => lead('contactBillCap')(db).update({ estimatedBill: 100000 }), expectTight: 'allow' },
    { id: 'manager estimatedBill zero on non-owned lead', uid: 'manager', run: (db) => lead('contactBillZero')(db).update({ estimatedBill: 0 }), expectTight: 'allow' },
    { id: 'manager partial name on lead missing name', uid: 'manager', run: (db) => lead('contactMissingName')(db).update({ name: 'Homeowner' }), expectTight: 'allow' },
    { id: 'setter partial phone on territory pin', uid: 'realSetter', run: (db) => lead('contactTerritoryPhone')(db).update({ phone: '7165550199' }), expectTight: 'allow' },
    { id: 'manager sends all 9 contact fields but changes name', uid: 'manager', run: (db) => lead('contactRename')(db).update({ ...CONTACT_SAVED, name: 'New Name' }), expectTight: 'deny' },
    { id: 'manager overwrites email on non-owned lead', uid: 'manager', run: (db) => lead('contactOverwriteEmail')(db).update({ email: 'other@example.com' }), expectTight: 'deny' },
    { id: 'setter partial email outside territory', uid: 'realSetter', run: (db) => lead('contactOutside')(db).update({ email: 'home@example.com' }), expectTight: 'deny' },
    { id: 'manager oversize email on non-owned lead', uid: 'manager', run: (db) => lead('contactOversizeEmail')(db).update({ email: 'e'.repeat(255) }), expectTight: 'deny' },
    { id: 'manager negative estimatedBill on non-owned lead', uid: 'manager', run: (db) => lead('contactNegativeBill')(db).update({ estimatedBill: -1 }), expectTight: 'deny' },
    { id: 'manager huge estimatedBill on non-owned lead', uid: 'manager', run: (db) => lead('contactHugeBill')(db).update({ estimatedBill: 100001 }), expectTight: 'deny' },
    { id: 'manager string estimatedBill on non-owned lead', uid: 'manager', run: (db) => lead('contactStringBill')(db).update({ estimatedBill: '150' }), expectTight: 'deny' },
    { id: 'manager deletes phone on non-owned lead', uid: 'manager', run: (db) => lead('contactDeletePhone')(db).update({ phone: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'manager deletes email on non-owned lead', uid: 'manager', run: (db) => lead('clearMgrEmail')(db).update({ email: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'manager deletes estimatedBill on non-owned lead', uid: 'manager', run: (db) => lead('clearMgrBill')(db).update({ estimatedBill: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'manager deletes notes on non-owned lead', uid: 'manager', run: (db) => lead('clearMgrNotes')(db).update({ notes: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'setter deletes phone on territory pin', uid: 'realSetter', run: (db) => lead('clearSetPhone')(db).update({ phone: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'setter deletes email on territory pin', uid: 'realSetter', run: (db) => lead('clearSetEmail')(db).update({ email: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'setter deletes estimatedBill on territory pin', uid: 'realSetter', run: (db) => lead('clearSetBill')(db).update({ estimatedBill: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'setter deletes notes on territory pin', uid: 'realSetter', run: (db) => lead('clearSetNotes')(db).update({ notes: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'setter deletes phone outside territory', uid: 'realSetter', run: (db) => lead('clearOutside')(db).update({ phone: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'setter deletes email outside territory', uid: 'realSetter', run: (db) => lead('clearOutside')(db).update({ email: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'setter deletes estimatedBill outside territory', uid: 'realSetter', run: (db) => lead('clearOutside')(db).update({ estimatedBill: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'setter deletes notes outside territory', uid: 'realSetter', run: (db) => lead('clearOutside')(db).update({ notes: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'demo deletes phone outside territory', uid: 'demo', run: (db) => lead('clearDemoOutside')(db).update({ phone: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'demo deletes phone on own territory pin', uid: 'demo', run: (db) => lead('clearDemoTerritory')(db).update({ phone: firebase.firestore.FieldValue.delete() }), expectTight: 'allow' },
    { id: 'manager adds email and setterId on non-owned lead', uid: 'manager', run: (db) => lead('contactEmailAndSetter')(db).update({ email: 'home@example.com', setterId: 'manager' }), expectTight: 'deny' },
    { id: 'manager staff assign setDoc on non-owned lead', uid: 'manager', run: (db) => lead('staffAssignLead')(db).set({ status: 'assigned', name: 'Homeowner', assignedTo: 'realSetter', assignedAt: new Date() }), expectTight: 'deny' },
    { id: 'setter knock deletes another claimedBy', uid: 'realSetter', run: (db) => lead('dispoClaimedPin')(db).update({ status: 'not-home', dispositionedAt: new Date(), claimedBy: firebase.firestore.FieldValue.delete() }), expectTight: 'deny' },
    { id: 'manager full-doc Go Back setDoc on non-owned lead', uid: 'manager', run: (db) => lead('dispoFullDoc')(db).set({ name: 'Homeowner', createdAt: new Date(), claimedAt: null, assignedAt: null, solarTestedAt: null, ...goBack('manager') }), expectTight: 'deny' },
    { id: 'manager partial Go Back on non-owned lead', uid: 'manager', run: (db) => lead('dispoFreshStranger')(db).update(goBack('manager', { goBackScheduledTime: '', goBackNotes: '' })), expectTight: 'allow' },
    { id: 'manager unverified GPS on a claimed pin', uid: 'manager', run: (db) => lead('gpsClaimed')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'no_fix' }), expectTight: 'allow' },
    { id: 'manager unverified GPS on an assigned pin', uid: 'manager', run: (db) => lead('gpsAssigned')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'stale' }), expectTight: 'allow' },
    { id: 'setter unverified GPS on a territory pin', uid: 'realSetter', run: (db) => lead('gpsTerritory')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'too_far', gpsDistanceM: 80 }), expectTight: 'allow' },
    { id: 'manager dispo with no GPS fields', uid: 'manager', run: (db) => lead('gpsNone')(db).update({ status: 'not-home', dispositionedAt: at }), expectTight: 'allow' },
    { id: 'manager far knock distance on non-owned lead', uid: 'manager', run: (db) => lead('gpsFar')(db).update({ status: 'not-home', dispositionedAt: at, knockGpsLat: 42.9, knockGpsLng: -78.8, knockGpsAccuracy: 30, knockDistanceFromAddress: 5000, gpsVerified: false, gpsUnverifiedReason: 'too_far', gpsDistanceM: 5000 }), expectTight: 'allow' },
    { id: 'manager bad gpsUnverifiedReason', uid: 'manager', run: (db) => lead('gpsBadReason')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'indoors' }), expectTight: 'deny' },
    { id: 'manager gpsVerified wrong type', uid: 'manager', run: (db) => lead('gpsBadType')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: 'false', gpsUnverifiedReason: 'no_fix' }), expectTight: 'deny' },
    { id: 'manager dispo with a fourth GPS key', uid: 'manager', run: (db) => lead('gpsFourth')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'other', gpsDistanceM: 12, gpsAccuracy: 3 }), expectTight: 'deny' },
    { id: 'manager knock latitude out of range', uid: 'manager', run: (db) => lead('gpsBadLat')(db).update({ status: 'not-home', dispositionedAt: at, knockGpsLat: 91 }), expectTight: 'deny' },
    { id: 'manager knock distance above 1e6', uid: 'manager', run: (db) => lead('gpsHugeDistance')(db).update({ status: 'not-home', dispositionedAt: at, knockDistanceFromAddress: 1000001 }), expectTight: 'deny' },
    { id: 'manager out_of_area on a non-owned lead', uid: 'manager', run: (db) => lead('gpsOutOfArea')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'out_of_area', gpsDistanceM: 120 }), expectTight: 'allow' },
    { id: 'owner bad gpsUnverifiedReason', uid: 'realSetter', run: (db) => lead('ownerGpsBad')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'indoors' }), expectTight: 'deny' },
    { id: 'owner valid gps flags', uid: 'realSetter', run: (db) => lead('ownerGpsOk')(db).update({ status: 'not-home', dispositionedAt: at, gpsVerified: false, gpsUnverifiedReason: 'low_accuracy', gpsDistanceM: 0 }), expectTight: 'allow' },
    { id: 'owner clears stale gps flags on a re-knock', uid: 'realSetter', run: (db) => lead('ownerGpsClear')(db).update({
      status: 'not-home', dispositionedAt: at,
      gpsVerified: firebase.firestore.FieldValue.delete(),
      gpsUnverifiedReason: firebase.firestore.FieldValue.delete(),
      gpsDistanceM: firebase.firestore.FieldValue.delete(),
    }), expectTight: 'allow' },
    { id: 'manager clears stale gps flags on a re-knock', uid: 'manager', run: (db) => lead('managerGpsClear')(db).update({
      status: 'not-home', dispositionedAt: at,
      gpsVerified: firebase.firestore.FieldValue.delete(),
      gpsUnverifiedReason: firebase.firestore.FieldValue.delete(),
      gpsDistanceM: firebase.firestore.FieldValue.delete(),
    }), expectTight: 'allow' },
    ...budgetRows,
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

async function outcomeOf(run: Promise<unknown>): Promise<Outcome> {
  try {
    await run;
    return 'allow';
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
    if (!code.includes('permission-denied')) throw error;
    return 'deny';
  }
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
      // Re-dispositioning a pin that already carries Go Back/objection values was denied
      // (changedKeys() on non-allowlisted keys). Bounded affectedKeys() allowlist fixes it.
      const intendedDispoFix = new Set(['setter Go Back on prior territory pin', 'manager objection on prior lead']);
      const dispoFixes: string[] = [];
      // Live changedKeys() denies any edit of an existing photos array. Appending
      // one valid photo is the 14.17 shape and is an intended allowance.
      const intendedPhotoAppend = new Set([
        'manager appends one photo on non-owned lead',
        'manager adds the 50th photo on a non-owned lead',
      ]);
      const photoAppends: string[] = [];
      const allowToDeny: string[] = [];
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
          } else if (intendedDispoFix.has(ruleCase.id)) {
            dispoFixes.push(line);
          } else if (intendedPhotoAppend.has(ruleCase.id)) {
            photoAppends.push(line);
          } else {
            loosened.push(line);
          }
        }
        if (before === 'allow' && after === 'deny') {
          allowToDeny.push(`${ruleCase.id}: deployed allowed, tightened denied`);
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
      for (const line of dispoFixes) console.log(`intended dispo fix: ${line}`);
      for (const line of photoAppends) console.log(`intended photo append: ${line}`);
      console.log(`allow-to-deny: ${allowToDeny.length}`);
      for (const line of allowToDeny) console.log(`allow-to-deny: ${line}`);
      assert.deepEqual(loosened, []);
      assert.equal(dispoFixes.length, intendedDispoFix.size);
      assert.equal(photoAppends.length, intendedPhotoAppend.size);
      assert.deepEqual(allowedExceptions, [
        `${intendedException}: deployed denied, tightened allowed`,
      ]);
    } finally {
      await deployed.cleanup();
      await tight.cleanup();
    }
  });

  it('compares every case against the live rules at 8533ae5', async () => {
    const live = await open('demo-rules-live-8533ae5', LIVE);
    const tight = await open('demo-rules-tight-vs-live', TIGHT);
    const liveClients = new Map<string, Firestore>();
    const tightClients = new Map<string, Firestore>();
    try {
      await seed(live);
      await seed(tight);
      const allowToDeny: string[] = [];
      const denyToAllow: string[] = [];
      const budgetMisses: string[] = [];
      for (const ruleCase of cases()) {
        const provider = ruleCase.provider ?? 'password';
        const before = await outcomeOf(ruleCase.run(client(live, ruleCase.uid, provider, liveClients)));
        const after = await outcomeOf(ruleCase.run(client(tight, ruleCase.uid, provider, tightClients)));
        if (before === 'allow' && after === 'deny') allowToDeny.push(ruleCase.id);
        if (before === 'deny' && after === 'allow') denyToAllow.push(ruleCase.id);
        if (ruleCase.id.startsWith('budget ') && (before !== 'allow' || after !== 'allow')) {
          budgetMisses.push(`${ruleCase.id}: live ${before}, tight ${after}`);
        }
      }
      console.log(`live cases: ${cases().length}`);
      console.log(`live allow-to-deny: ${allowToDeny.length}`);
      for (const id of allowToDeny) console.log(`allow-to-deny: ${id}`);
      console.log(`live deny-to-allow: ${denyToAllow.length}`);
      for (const id of denyToAllow) console.log(`deny-to-allow: ${id}`);
      assert.deepEqual(budgetMisses, []);
    } finally {
      await live.cleanup();
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
