import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPOWER_BUMP_LIMIT,
  EMPOWER_BUMP_NOT_CONFIGURED,
  handleEmpowerBump,
  isEmpowerBumpEnabled,
  type EmpowerBumpDeps,
  type EmpowerBumpOptionalFields,
} from '../app/utils/server/empowerBump.ts';
import {
  ESTIMATED_BAND_LABELS,
  ASSISTANCE_PROGRAMS,
  EMPOWER_CREATE_STAGE_ID,
  EMPOWER_PIPELINE_ID,
  GHL_FIELDS,
  bandForIncome,
  incomeLimitsFor,
  incomeSelectionLabel,
  parseEmpowerBumpBody,
  resolveBand,
} from '../app/utils/server/empowerBumpContract.ts';
import { EMPOWER_INCOME_LIMITS } from '../app/utils/server/empowerIncomeLimits.ts';
import { createGhlClient, type FetchLike } from '../app/utils/server/empowerBumpGhl.ts';
import {
  createEmpowerBumpDiscordPoster,
  maskWebhookUrl,
  resolveEmpowerBumpWebhook,
  type DiscordFetch,
} from '../app/utils/server/empowerBumpDiscord.ts';
import {
  EMPOWER_BUMP_EVENTS,
  EMPOWER_BUMP_RECEIPTS,
  createEventStore,
  createReceiptStore,
  type DocRefLike,
  type FirestoreLike,
} from '../app/utils/server/empowerBumpStore.ts';

// Obvious fakes only.
const FAKE_TOKEN = 'ghl-fake-token-for-tests';
const PHONE = '(555) 010-0123';
const PHONE_E164 = '+15550100123';
const EMAIL = 'jane.neighbor@example.com';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'draft-0001-abcdef',
    actedAt: '2026-11-23T19:06:00.000-07:00',
    leadId: 'lead-123',
    name: 'Jane Neighbor',
    phone: PHONE,
    email: EMAIL,
    address: '123 Main St',
    city: 'Buffalo',
    state: 'ny',
    zip: '14201',
    county: 'Erie',
    householdSize: 3,
    estimatedBand: 'tier3',
    assistanceNone: true,
    assistancePrograms: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------- fake Firestore

class FakeFirestore implements FirestoreLike {
  docs = new Map<string, { data: Record<string, unknown>; version: number }>();
  writes: string[] = [];
  failCreateIn = new Set<string>();

  collection(name: string) {
    return {
      doc: (id: string): DocRefLike => {
        const path = `${name}/${id}`;
        return {
          get: async () => {
            const entry = this.docs.get(path);
            return {
              exists: Boolean(entry),
              data: () => (entry ? { ...entry.data } : undefined),
              updateTime: entry ? entry.version : undefined,
            };
          },
          create: async (data) => {
            if (this.failCreateIn.has(name)) throw Object.assign(new Error('unavailable'), { code: 14 });
            if (this.docs.has(path)) throw Object.assign(new Error('exists'), { code: 6 });
            this.writes.push(`create ${path}`);
            this.docs.set(path, { data: { ...data }, version: 1 });
          },
          set: async (data) => {
            this.writes.push(`set ${path}`);
            const prev = this.docs.get(path);
            this.docs.set(path, { data: { ...data }, version: (prev?.version ?? 0) + 1 });
          },
          update: async (data, precondition) => {
            const prev = this.docs.get(path);
            if (!prev) throw Object.assign(new Error('missing'), { code: 5 });
            if (precondition?.lastUpdateTime !== undefined && precondition.lastUpdateTime !== prev.version) {
              throw Object.assign(new Error('precondition'), { code: 9 });
            }
            this.writes.push(`update ${path}`);
            this.docs.set(path, { data: { ...prev.data, ...data }, version: prev.version + 1 });
          },
          delete: async () => {
            this.writes.push(`delete ${path}`);
            this.docs.delete(path);
          },
        };
      },
    };
  }
}

// ---------------------------------------------------------------- fake GHL HTTP

type FakeContact = { id: string; phone?: string; email?: string; customFields: Array<{ id: string; value: unknown }> };
type FakeOpp = {
  id: string;
  contactId: string;
  pipelineId: string;
  status: string;
  updatedAt: string;
  customFields: Array<{ id: string; fieldValueString?: string; value?: unknown }>;
};

class FakeGhl {
  contacts = new Map<string, FakeContact>();
  opps: FakeOpp[] = [];
  calls: Array<{ method: string; path: string; query: Record<string, string>; body?: unknown; auth?: string }> = [];
  nextId = 1;
  failOn?: { method: string; pathPrefix: string; status: number };
  oppSearchShape: 'ok' | 'broken' = 'ok';

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://services.leadconnectorhq.com');
    assert.equal(init.headers.Version, '2021-07-28');
    assert.equal(init.redirect, 'error');
    const query = Object.fromEntries(u.searchParams.entries());
    const parsedBody = init.body ? JSON.parse(init.body) : undefined;
    this.calls.push({ method: init.method, path: u.pathname, query, body: parsedBody, auth: init.headers.Authorization });
    const json = (status: number, payload: unknown) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(payload),
    });
    if (this.failOn && init.method === this.failOn.method && u.pathname.startsWith(this.failOn.pathPrefix)) {
      return json(this.failOn.status, { message: 'internal detail that must not leak' });
    }

    if (init.method === 'GET' && u.pathname === '/contacts/search/duplicate') {
      assert.equal(query.locationId, 'MMKRDviKggXzlcHQTnvZ');
      const found = [...this.contacts.values()].find((c) => (
        (query.number && c.phone && c.phone.replace(/\D/g, '').slice(-10) === query.number.replace(/\D/g, '').slice(-10))
        || (query.email && c.email && c.email.toLowerCase() === query.email.toLowerCase())
      ));
      return json(200, { contact: found ? { id: found.id, phone: found.phone, email: found.email } : null });
    }
    const contactMatch = /^\/contacts\/([^/]+)$/.exec(u.pathname);
    if (init.method === 'GET' && contactMatch) {
      const c = this.contacts.get(contactMatch[1]);
      return c ? json(200, { contact: c }) : json(404, {});
    }
    if (init.method === 'POST' && u.pathname === '/contacts/') {
      const id = `contact-${this.nextId++}`;
      this.contacts.set(id, { id, phone: parsedBody.phone, email: parsedBody.email, customFields: [] });
      return json(201, { contact: { id } });
    }
    if (init.method === 'PUT' && contactMatch) {
      return this.contacts.has(contactMatch[1]) ? json(200, { succeeded: true }) : json(404, {});
    }
    if (init.method === 'POST' && /^\/contacts\/[^/]+\/(notes|tags)$/.test(u.pathname)) {
      return json(201, { note: { id: 'note-1' } });
    }
    if (init.method === 'GET' && u.pathname === '/opportunities/search') {
      if (this.oppSearchShape === 'broken') return json(200, { meta: {} });
      const items = this.opps.filter((o) => o.contactId === query.contact_id && o.pipelineId === query.pipeline_id);
      return json(200, { opportunities: items });
    }
    if (init.method === 'POST' && u.pathname === '/opportunities/') {
      const id = `opp-${this.nextId++}`;
      this.opps.push({
        id,
        contactId: parsedBody.contactId,
        pipelineId: parsedBody.pipelineId,
        status: 'open',
        updatedAt: new Date().toISOString(),
        customFields: [],
      });
      return json(201, { opportunity: { id } });
    }
    if (init.method === 'PUT' && /^\/opportunities\/[^/]+$/.test(u.pathname)) {
      return json(200, { opportunity: { id: u.pathname.split('/').pop() } });
    }
    return json(404, {});
  };

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }

  count(method: string, path: string) {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }

  contactWrite() {
    return this.calls.find((c) => (c.method === 'PUT' && /^\/contacts\/[^/]+$/.test(c.path)) || (c.method === 'POST' && c.path === '/contacts/'));
  }

  oppWrite() {
    return this.calls.find((c) => (c.method === 'PUT' && c.path.startsWith('/opportunities/')) || (c.method === 'POST' && c.path === '/opportunities/'));
  }

  note() {
    const call = this.calls.find((c) => c.method === 'POST' && c.path.endsWith('/notes'));
    return (call?.body as { body?: string } | undefined)?.body ?? '';
  }
}

function fieldValue(call: { body?: unknown } | undefined, id: string): unknown {
  const fields = ((call?.body as { customFields?: Array<{ id: string; fieldValue: unknown }> } | undefined)?.customFields) ?? [];
  const hit = fields.find((f) => f.id === id);
  return hit ? hit.fieldValue : undefined;
}

function hasField(call: { body?: unknown } | undefined, id: string): boolean {
  const fields = ((call?.body as { customFields?: Array<{ id: string }> } | undefined)?.customFields) ?? [];
  return fields.some((f) => f.id === id);
}

// ---------------------------------------------------------------- harness

function harness(overrides: {
  enabled?: boolean;
  uid?: string;
  user?: Record<string, unknown>;
  servicesMissing?: boolean;
  optionalFields?: EmpowerBumpOptionalFields;
  now?: () => number;
  /** DISCORD_EMPOWER_BUMP_WEBHOOK_URL */
  overrideWebhook?: string;
  /** DISCORD_NOTIFICATION_WEBHOOK_URL (scheduling manager env) */
  schedulingEnvWebhook?: string;
  /** adminSettings/global.notificationWebhook */
  storedSchedulingWebhook?: unknown;
  discordStatus?: number;
} = {}) {
  const discordPosts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const discordFetch: DiscordFetch = async (url, init) => {
    assert.equal(init.redirect, 'error');
    discordPosts.push({ url, body: JSON.parse(init.body) });
    const status = overrides.discordStatus ?? 204;
    return { ok: status < 400, status };
  };
  const ghl = new FakeGhl();
  const raydarDb = new FakeFirestore();
  const ghlDb = new FakeFirestore();
  const logs: string[] = [];
  const rateLimitStore = new Map<string, number[]>();
  let clock = 1_700_000_000_000;
  const uid = overrides.uid ?? 'uid-rep-1';
  const deps: EmpowerBumpDeps = {
    isEnabled: () => overrides.enabled !== false,
    verifyIdToken: async () => ({ uid }),
    getUser: async () => ({
      exists: true,
      data: overrides.user ?? { role: 'setter', name: 'Riley Rep', email: 'rep@company.com', approved: true },
    }),
    getServices: () => (overrides.servicesMissing ? null : {
      ghl: createGhlClient({ token: FAKE_TOKEN, fetch: ghl.fetch }),
      receipts: createReceiptStore(raydarDb),
      events: createEventStore(ghlDb),
      optionalFields: overrides.optionalFields ?? {},
      discord: {
        resolveWebhook: () => resolveEmpowerBumpWebhook({
          overrideValue: overrides.overrideWebhook,
          schedulingEnvValue: overrides.schedulingEnvWebhook,
          readStoredSchedulingWebhook: async () => overrides.storedSchedulingWebhook ?? null,
        }),
        post: createEmpowerBumpDiscordPoster(discordFetch),
      },
    }),
    now: overrides.now ?? (() => clock),
    rateLimitStore,
    log: (event, meta) => logs.push(`${event} ${JSON.stringify(meta)}`),
  };
  return {
    ghl,
    raydarDb,
    ghlDb,
    logs,
    discordPosts,
    advance: (ms: number) => { clock += ms; },
    run: (b: unknown, opts: { authorization?: string | null; idempotencyKey?: string | null } = {}) => handleEmpowerBump({
      authorization: opts.authorization === undefined ? 'Bearer good-token' : opts.authorization,
      idempotencyKey: opts.idempotencyKey ?? null,
      body: b,
      deps,
    }),
  };
}

function seedContact(ghl: FakeGhl, contact: Partial<FakeContact> & { id: string }) {
  ghl.contacts.set(contact.id, { customFields: [], ...contact });
}

// Console capture for the no-PII check.
let consoleLines: string[] = [];
const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
beforeEach(() => {
  consoleLines = [];
  for (const key of ['log', 'info', 'warn', 'error'] as const) {
    console[key] = (...args: unknown[]) => { consoleLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  }
});
afterEach(() => {
  Object.assign(console, originals);
});

// ================================================================ tests

describe('empower bump: feature flag', () => {
  it('flag off returns 503 with zero GHL calls, zero Firestore writes, no Discord event', async () => {
    const t = harness({ enabled: false });
    const result = await t.run(body());
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: EMPOWER_BUMP_NOT_CONFIGURED });
    assert.equal(t.ghl.calls.length, 0);
    assert.deepEqual(t.raydarDb.writes, []);
    assert.deepEqual(t.ghlDb.writes, []);
  });

  it('flag parsing: only explicit on values enable', () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'no', ' ']) assert.equal(isEmpowerBumpEnabled(v), false, String(v));
    for (const v of ['1', 'true', 'TRUE', 'on', 'yes']) assert.equal(isEmpowerBumpEnabled(v), true, v);
  });

  it('missing GHL/Firestore credentials returns 503 and writes nothing', async () => {
    const t = harness({ servicesMissing: true });
    const result = await t.run(body());
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: EMPOWER_BUMP_NOT_CONFIGURED });
    assert.equal(t.ghl.calls.length, 0);
  });
});

describe('empower bump: auth', () => {
  it('missing bearer is 401 with no GHL calls', async () => {
    const t = harness();
    const result = await t.run(body(), { authorization: null });
    assert.equal(result.status, 401);
    assert.equal(t.ghl.calls.length, 0);
  });

  it('test accounts are 403 with no GHL calls', async () => {
    for (const user of [
      { name: 'T', email: 'someone@test.com' },
      { name: 'T', isTest: true },
      { name: 'T', accountType: 'test' },
    ]) {
      const t = harness({ user });
      const result = await t.run(body());
      assert.equal(result.status, 403);
      assert.equal(t.ghl.calls.length, 0);
      assert.deepEqual(t.raydarDb.writes, []);
    }
    const byUid = harness({ uid: 'user-test-1' });
    assert.equal((await byUid.run(body())).status, 403);
  });

  it('unapproved accounts are 403', async () => {
    const t = harness({ user: { name: 'R', approved: false } });
    assert.equal((await t.run(body())).status, 403);
    assert.equal(t.ghl.calls.length, 0);
  });
});

describe('empower bump: rate limit', () => {
  it(`allows ${EMPOWER_BUMP_LIMIT} per uid per minute, then 429 with Retry-After`, async () => {
    const t = harness();
    for (let i = 0; i < EMPOWER_BUMP_LIMIT; i += 1) {
      const r = await t.run(body({ draftId: `draft-rate-${i}-xx` }));
      assert.equal(r.status, 200, `request ${i}`);
    }
    const limited = await t.run(body({ draftId: 'draft-rate-9-xx' }));
    assert.equal(limited.status, 429);
    assert.equal(limited.headers?.['Retry-After'], '60');
    t.advance(60_000);
    assert.equal((await t.run(body({ draftId: 'draft-rate-10-xx' }))).status, 200);
  });
});

describe('empower bump: validation', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['missing draftId', { draftId: undefined }],
    ['short draftId', { draftId: 'abc' }],
    ['bad draftId chars', { draftId: 'draft id with spaces' }],
    ['missing actedAt', { actedAt: undefined }],
    ['non-ISO actedAt', { actedAt: 'yesterday' }],
    ['missing leadId', { leadId: '' }],
    ['missing name', { name: '  ' }],
    ['missing phone', { phone: undefined }],
    ['short phone', { phone: '555-0100' }],
    ['householdSize 0', { householdSize: 0 }],
    ['householdSize 11', { householdSize: 11 }],
    ['householdSize 2.5', { householdSize: 2.5 }],
    ['householdSize string', { householdSize: '3' }],
    ['unknown county', { county: 'Atlantis' }],
    ['unknown assistance label', { assistancePrograms: ['SNAP'], assistanceNone: false }],
    ['assistanceNone + programs', { assistancePrograms: [ASSISTANCE_PROGRAMS[0]], assistanceNone: true }],
    ['extra key', { notes: 'free-form' }],
    ['unknown band', { estimatedBand: 'tier2' }],
    ['band without county', { county: undefined, estimatedBand: 'tier1' }],
    ['negative income', { annualHouseholdIncome: -1 }],
    ['huge income', { annualHouseholdIncome: 10_000_001 }],
    ['state not 2 letters', { state: 'New York' }],
  ];
  for (const [label, override] of bad) {
    it(`400: ${label}`, async () => {
      const t = harness();
      const b = body(override);
      for (const [k, v] of Object.entries(override)) if (v === undefined) delete b[k];
      const result = await t.run(b);
      assert.equal(result.status, 400, label);
      assert.equal(t.ghl.calls.length, 0);
    });
  }

  it('accepts householdSize 1 and 10, St. Lawrence and New York counties, case-insensitively', () => {
    for (const [hh, county] of [[1, 'St. Lawrence'], [10, 'new york'], [5, 'ERIE']] as const) {
      const parsed = parseEmpowerBumpBody(body({ householdSize: hh, county }));
      assert.equal(parsed.ok, true);
    }
  });

  it('not_sure or no band does not need a county', () => {
    assert.equal(parseEmpowerBumpBody(body({ county: undefined, estimatedBand: 'not_sure' })).ok, true);
    const b = body({ estimatedBand: undefined });
    delete b.county;
    delete b.estimatedBand;
    assert.equal(parseEmpowerBumpBody(b).ok, true);
  });

  it('Idempotency-Key header: accepted alone, must match body draftId when both are sent', async () => {
    const b = body();
    delete b.draftId;
    const headerOnly = parseEmpowerBumpBody(b, 'draft-from-header-1');
    assert.equal(headerOnly.ok && headerOnly.value.draftId, 'draft-from-header-1');
    const t = harness();
    const mismatch = await t.run(body(), { idempotencyKey: 'draft-other-0002' });
    assert.equal(mismatch.status, 400);
    assert.equal(t.ghl.calls.length, 0);
    const match = await t.run(body(), { idempotencyKey: 'draft-0001-abcdef' });
    assert.equal(match.status, 200);
  });

  it('assistance programs force tier1 even when the client sent comfort_home', async () => {
    const parsed = parseEmpowerBumpBody(body({
      estimatedBand: 'comfort_home',
      assistanceNone: false,
      assistancePrograms: [ASSISTANCE_PROGRAMS[1], ASSISTANCE_PROGRAMS[0]],
    }));
    assert.ok(parsed.ok);
    assert.deepEqual(resolveBand(parsed.value), { band: 'tier1', categorical: true, source: 'assistance' });
    // Manual order is kept regardless of tap order.
    assert.deepEqual(parsed.value.assistancePrograms, [ASSISTANCE_PROGRAMS[0], ASSISTANCE_PROGRAMS[1]]);

    const t = harness();
    const result = await t.run(body({ estimatedBand: 'comfort_home', assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[2]] }));
    assert.equal(result.status, 200);
    assert.equal(fieldValue(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier), 'Tier 1');
    assert.equal(fieldValue(t.ghl.oppWrite(), GHL_FIELDS.opportunityEmpowerTier), 'Tier 1');
    assert.match(t.ghl.note(), /Categorical Tier 1: yes/);
    assert.match(t.ghl.note(), /Government assistance: SSI \(Supplemental Security Income\)/);
  });
});

describe('empower bump: band math (Charles override: Comfort Home is strictly above M)', () => {
  it('Erie HH1: L=42450, M=56600 boundaries', () => {
    assert.deepEqual(incomeLimitsFor('Erie', 1), { tier1Limit: 42450, tier3Cap: 56600 });
    assert.equal(bandForIncome('Erie', 1, 42450), 'tier1');
    assert.equal(bandForIncome('Erie', 1, 42451), 'tier3');
    assert.equal(bandForIncome('Erie', 1, 56600), 'tier3');
    assert.equal(bandForIncome('Erie', 1, 56601), 'comfort_home');
    assert.equal(bandForIncome('Erie', 1, 0), 'tier1');
  });

  it('every county and household size: exactly L, L+1, exactly M, M+1', () => {
    const counties = Object.keys(EMPOWER_INCOME_LIMITS);
    assert.equal(counties.length, 62);
    for (const county of counties) {
      for (let hh = 1; hh <= 10; hh += 1) {
        const limits = incomeLimitsFor(county, hh);
        assert.ok(limits);
        assert.ok(limits.tier1Limit < limits.tier3Cap, `${county} HH${hh}`);
        assert.equal(bandForIncome(county, hh, limits.tier1Limit), 'tier1');
        assert.equal(bandForIncome(county, hh, limits.tier1Limit + 1), 'tier3');
        assert.equal(bandForIncome(county, hh, limits.tier3Cap), 'tier3');
        assert.equal(bandForIncome(county, hh, limits.tier3Cap + 1), 'comfort_home');
      }
    }
  });

  it('spot-checks the CSV values used in the specs', () => {
    assert.deepEqual(incomeLimitsFor('Monroe', 1), { tier1Limit: 43650, tier3Cap: 58200 });
    assert.deepEqual(incomeLimitsFor('Onondaga', 1), { tier1Limit: 43500, tier3Cap: 58000 });
    assert.deepEqual(incomeLimitsFor('Erie', 4), { tier1Limit: 80160, tier3Cap: 106880 });
    assert.equal(incomeLimitsFor('Erie', 11), null);
  });

  it('incomeSelectionLabel uses the form bracket, including published dollar ranges, never a raw income', () => {
    assert.equal(incomeSelectionLabel({ band: 'not_sure', county: 'Erie', householdSize: 1 }), 'Not sure');
    assert.equal(incomeSelectionLabel({ band: 'tier1' }), 'Tier 1 (est.)');
    assert.equal(
      incomeSelectionLabel({ band: 'tier1', county: 'Erie', householdSize: 1 }),
      'Tier 1 (est.) — at or under $42,450',
    );
    assert.equal(
      incomeSelectionLabel({ band: 'tier3', county: 'Erie', householdSize: 1 }),
      'Tier 3 (est.) — above $42,450 and at or under $56,600',
    );
    assert.equal(
      incomeSelectionLabel({ band: 'comfort_home', county: 'Erie', householdSize: 1 }),
      'Comfort Home (est.) — above $56,600',
    );
    assert.equal(
      incomeSelectionLabel({ band: 'tier1', county: 'Erie', householdSize: 1, categorical: true }),
      'Tier 1 (assistance program)',
    );
    assert.doesNotMatch(
      incomeSelectionLabel({ band: 'tier1', county: 'Erie', householdSize: 1, categorical: true }),
      /\$/,
    );
  });

  it('an exact typed income is mapped server-side; exactly at M stays Tier 3', async () => {
    const t = harness();
    const result = await t.run(body({ householdSize: 1, estimatedBand: 'comfort_home', annualHouseholdIncome: 56600 }));
    assert.equal(result.status, 200);
    assert.equal(fieldValue(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier), 'Tier 3');
    const above = harness();
    await above.run(body({ householdSize: 1, estimatedBand: 'tier3', annualHouseholdIncome: 56601 }));
    assert.equal(hasField(above.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier), false);
    assert.match(above.ghl.note(), /Estimated band: Comfort Home \(est\.\)/);
  });
});

describe('empower bump: GHL contact lookup', () => {
  it('phone last-10 hit updates that contact (no contact create)', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c-phone', phone: '+1 555 010 0123' });
    const result = await t.run(body({ email: undefined }));
    assert.equal(result.status, 200);
    assert.equal(result.body && 'contactId' in result.body && result.body.contactId, 'c-phone');
    assert.equal(t.ghl.count('POST', '/contacts/'), 0);
    assert.equal(t.ghl.count('PUT', '/contacts/c-phone'), 1);
    const lookup = t.ghl.calls.find((c) => c.path === '/contacts/search/duplicate');
    assert.equal(lookup?.query.number, PHONE_E164);
    assert.equal(lookup?.auth, `Bearer ${FAKE_TOKEN}`);
  });

  it('email is used only when the phone misses', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c-email', phone: '+17165550000', email: EMAIL });
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(result.body && 'contactId' in result.body && result.body.contactId, 'c-email');
    assert.equal(t.ghl.count('POST', '/contacts/'), 0);
  });

  it('phone and email matching two different contacts is 409 with no writes', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c-phone', phone: PHONE_E164 });
    seedContact(t.ghl, { id: 'c-email', phone: '+17165550000', email: EMAIL });
    const result = await t.run(body());
    assert.equal(result.status, 409);
    assert.deepEqual(t.ghl.writes(), []);
    assert.equal(t.raydarDb.docs.size, 0, 'claim released, no receipt');
    assert.equal(t.ghlDb.docs.size, 0);
  });

  it('no match creates a contact with Empower+ = Yes, household size, Portal Creation Needed', async () => {
    const t = harness();
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(t.ghl.count('POST', '/contacts/'), 1);
    const create = t.ghl.contactWrite();
    const b = create?.body as Record<string, unknown>;
    assert.equal(b.locationId, 'MMKRDviKggXzlcHQTnvZ');
    assert.equal(b.phone, PHONE_E164);
    assert.equal(b.firstName, 'Jane');
    assert.equal(b.lastName, 'Neighbor');
    assert.equal(b.state, 'NY');
    assert.equal(fieldValue(create, GHL_FIELDS.contactEmpower), 'Yes');
    assert.equal(fieldValue(create, GHL_FIELDS.contactHouseholdSize), 3);
    assert.equal(fieldValue(create, GHL_FIELDS.contactEmpowerStatus), 'Portal Creation Needed');
  });

  it('does not move a later Empower Status backward', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164, customFields: [{ id: GHL_FIELDS.contactEmpowerStatus, value: 'Portal Created' }] });
    await t.run(body());
    assert.equal(hasField(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerStatus), false);
  });
});

describe('empower bump: opportunity update vs create', () => {
  it('no Empower+ opp: creates one at Portal Creation Needed on the Empower+ pipeline', async () => {
    const t = harness();
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(result.body && 'outcome' in result.body && result.body.outcome, 'created');
    const create = t.ghl.oppWrite();
    assert.equal(create?.method, 'POST');
    const b = create?.body as Record<string, unknown>;
    assert.equal(b.pipelineId, EMPOWER_PIPELINE_ID);
    assert.equal(b.pipelineStageId, EMPOWER_CREATE_STAGE_ID);
    assert.equal(b.status, 'open');
    assert.equal(fieldValue(create, GHL_FIELDS.opportunityEmpower), 'Yes');
    assert.equal(fieldValue(create, GHL_FIELDS.opportunityEmpowerTier), 'Tier 3');
  });

  it('existing Empower+ opp: updates the most recently updated open one, never creates a second', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.opps.push(
      { id: 'opp-old', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-10-01T00:00:00Z', customFields: [] },
      { id: 'opp-new', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-11-01T00:00:00Z', customFields: [{ id: GHL_FIELDS.opportunityNotes, fieldValueString: 'Earlier note' }] },
      { id: 'opp-lost', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'lost', updatedAt: '2026-11-20T00:00:00Z', customFields: [] },
      { id: 'opp-solar', contactId: 'c1', pipelineId: 'solar-pipeline', status: 'open', updatedAt: '2026-11-22T00:00:00Z', customFields: [] },
    );
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(result.body && 'outcome' in result.body && result.body.outcome, 'updated');
    assert.equal(result.body && 'opportunityId' in result.body && result.body.opportunityId, 'opp-new');
    assert.equal(t.ghl.count('POST', '/opportunities/'), 0);
    const update = t.ghl.oppWrite();
    assert.equal(update?.path, '/opportunities/opp-new');
    const b = update?.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(b), ['customFields'], 'stage/pipeline/status untouched on update');
    const notes = String(fieldValue(update, GHL_FIELDS.opportunityNotes));
    assert.ok(notes.startsWith('Earlier note\n\nEmpower Bump (estimate only'), 'existing notes kept');
    const search = t.ghl.calls.find((c) => c.path === '/opportunities/search');
    assert.equal(search?.query.pipeline_id, EMPOWER_PIPELINE_ID);
    assert.equal(search?.query.contact_id, 'c1');
  });

  it('unexpected opportunity search shape is 502 and never creates an opp', async () => {
    const t = harness();
    t.ghl.oppSearchShape = 'broken';
    const result = await t.run(body());
    assert.equal(result.status, 502);
    assert.equal(t.ghl.count('POST', '/opportunities/'), 0);
  });
});

describe('empower bump: official Empower Tier picklists', () => {
  for (const band of ['comfort_home', 'not_sure'] as const) {
    it(`${band} never writes contact or opportunity Empower Tier`, async () => {
      const t = harness();
      const result = await t.run(body({ estimatedBand: band }));
      assert.equal(result.status, 200);
      assert.equal(hasField(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier), false);
      assert.equal(hasField(t.ghl.oppWrite(), GHL_FIELDS.opportunityEmpowerTier), false);
      for (const call of t.ghl.writes()) {
        const text = JSON.stringify(call.body ?? {});
        assert.equal(/"fieldValue":"(Comfort Home|Not sure)/.test(text), false, 'no Comfort Home/Not sure into picklists');
      }
    });
  }

  for (const prior of ['Tier 1', 'Tier 3']) {
    it(`Comfort Home (est.) leaves an earlier official ${prior} and adds the note`, async () => {
      const t = harness();
      seedContact(t.ghl, { id: 'c1', phone: PHONE_E164, customFields: [{ id: GHL_FIELDS.contactEmpowerTier, value: prior }] });
      t.ghl.opps.push({ id: 'opp-1', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-11-01T00:00:00Z', customFields: [] });
      const result = await t.run(body({ estimatedBand: 'comfort_home' }));
      assert.equal(result.status, 200);
      assert.equal(hasField(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier), false);
      assert.equal(hasField(t.ghl.oppWrite(), GHL_FIELDS.opportunityEmpowerTier), false);
      assert.match(t.ghl.note(), /Estimated band: Comfort Home \(est\.\)/);
      assert.match(t.ghl.note(), new RegExp(`Official Empower Tier left unchanged at ${prior}`));
    });
  }

  it('new GHL fields are no-ops until their ids are configured', async () => {
    const t = harness();
    await t.run(body({ assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[0]] }));
    const ids = (((t.ghl.contactWrite()?.body as { customFields: Array<{ id: string }> }).customFields) ?? []).map((f) => f.id).sort();
    assert.deepEqual(ids, [
      GHL_FIELDS.contactEmpower,
      GHL_FIELDS.contactEmpowerStatus,
      GHL_FIELDS.contactEmpowerTier,
      GHL_FIELDS.contactHouseholdSize,
    ].sort());
    assert.equal(t.ghl.calls.some((c) => c.path.endsWith('/tags')), false, 'no tag write by default');

    const withIds = harness({ optionalFields: { estimatedBandFieldId: 'bandFieldId01', assistanceFieldId: 'assistFieldId01', tag: 'Empower Bump' } });
    await withIds.run(body({ assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[0]] }));
    assert.equal(fieldValue(withIds.ghl.contactWrite(), 'bandFieldId01'), 'Tier 1 (est.)');
    assert.deepEqual(fieldValue(withIds.ghl.contactWrite(), 'assistFieldId01'), [ASSISTANCE_PROGRAMS[0]]);
    assert.equal(withIds.ghl.calls.filter((c) => c.path.endsWith('/tags')).length, 1);
  });
});

describe('empower bump: annual household income', () => {
  it('is written only when an exact number is in the body', async () => {
    const none = harness();
    await none.run(body());
    assert.equal(hasField(none.ghl.contactWrite(), GHL_FIELDS.contactAnnualHouseholdIncome), false);
    assert.equal(/\$/.test(none.ghl.note()), false, 'no dollar amount in the note');

    const exact = harness();
    await exact.run(body({ annualHouseholdIncome: 61000 }));
    assert.equal(fieldValue(exact.ghl.contactWrite(), GHL_FIELDS.contactAnnualHouseholdIncome), 61000);
  });
});

describe('empower bump: receipts and replay', () => {
  it('second POST with the same draftId is a 200 replay with no second GHL write or event', async () => {
    const t = harness();
    const first = await t.run(body());
    assert.equal(first.status, 200);
    const writesAfterFirst = t.ghl.writes().length;
    const receipt = t.raydarDb.docs.get(`${EMPOWER_BUMP_RECEIPTS}/uid-rep-1_draft-0001-abcdef`)?.data;
    assert.equal(receipt?.status, 'done');
    assert.equal(receipt?.actedAt, '2026-11-23T19:06:00.000-07:00', 'device actedAt stored as sent');
    for (const key of ['draftId', 'uid', 'leadId', 'actedAt', 'contactId', 'opportunityId', 'outcome', 'createdAt']) {
      assert.ok(key in (receipt ?? {}), key);
    }

    const second = await t.run(body());
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { ...(first.body as object), replay: true });
    assert.equal(t.ghl.writes().length, writesAfterFirst);
    assert.equal(t.ghl.count('POST', '/opportunities/'), 1);
    assert.equal([...t.ghlDb.docs.keys()].filter((k) => k.startsWith(EMPOWER_BUMP_EVENTS)).length, 1);
  });

  it('a concurrent request for an in-flight draft is 409 and writes nothing to GHL', async () => {
    const t = harness();
    await t.raydarDb.collection(EMPOWER_BUMP_RECEIPTS).doc('uid-rep-1_draft-0001-abcdef')
      .create({ status: 'in_flight', uid: 'uid-rep-1', draftId: 'draft-0001-abcdef', leadId: 'lead-123', claimedAtMs: 1_700_000_000_000 });
    const result = await t.run(body());
    assert.equal(result.status, 409);
    assert.equal(t.ghl.calls.length, 0);
  });

  it('an abandoned in-flight claim is taken over after it goes stale', async () => {
    const t = harness();
    await t.raydarDb.collection(EMPOWER_BUMP_RECEIPTS).doc('uid-rep-1_draft-0001-abcdef')
      .create({ status: 'in_flight', uid: 'uid-rep-1', draftId: 'draft-0001-abcdef', leadId: 'lead-123', claimedAtMs: 1_700_000_000_000 - 121_000 });
    assert.equal((await t.run(body())).status, 200);
  });

  it('reusing a draftId for a different lead is 409', async () => {
    const t = harness();
    await t.run(body());
    const result = await t.run(body({ leadId: 'lead-999' }));
    assert.equal(result.status, 409);
  });

  it('ambiguous GHL error: 502, no receipt, no event, no automatic retry', async () => {
    const t = harness();
    t.ghl.failOn = { method: 'POST', pathPrefix: '/opportunities/', status: 500 };
    const result = await t.run(body());
    assert.equal(result.status, 502);
    assert.equal(JSON.stringify(result.body).includes('internal detail'), false);
    assert.equal(JSON.stringify(result.body).includes('leadconnectorhq'), false);
    assert.equal(t.ghl.count('POST', '/opportunities/'), 1, 'exactly one attempt');
    assert.equal(t.raydarDb.docs.size, 0, 'no receipt');
    assert.equal(t.ghlDb.docs.size, 0, 'no bump event');
  });

  it('network failure surfaces once, with no URL or token in the error', async () => {
    let attempts = 0;
    const ghl = createGhlClient({ token: FAKE_TOKEN, fetch: async () => { attempts += 1; throw new Error('ECONNRESET'); } });
    await assert.rejects(() => ghl.findContactByPhone(PHONE_E164), /GHL contact phone lookup failed \(network\)/);
    assert.equal(attempts, 1);
  });

  it('event write failure after GHL success is 502 with no receipt; resend updates, never creates a second opp', async () => {
    const t = harness();
    t.ghlDb.failCreateIn.add(EMPOWER_BUMP_EVENTS);
    const first = await t.run(body());
    assert.equal(first.status, 502);
    assert.equal(t.raydarDb.docs.size, 0);
    t.ghlDb.failCreateIn.clear();
    const resend = await t.run(body());
    assert.equal(resend.status, 200);
    assert.equal(resend.body && 'outcome' in resend.body && resend.body.outcome, 'updated');
    assert.equal(t.ghl.count('POST', '/opportunities/'), 1);
  });
});

describe('empower bump: Discord event doc (ghl-sync is the only poster)', () => {
  it('create writes one event with the agreed fields and no phone, email, or income', async () => {
    const t = harness();
    await t.run(body({ annualHouseholdIncome: 95000, city: 'Buffalo', town: undefined, name: 'Jane @everyone Neighbor' }));
    const events = [...t.ghlDb.docs.entries()].filter(([k]) => k.startsWith(`${EMPOWER_BUMP_EVENTS}/`));
    assert.equal(events.length, 1);
    const [path, { data }] = events[0];
    assert.equal(path, `${EMPOWER_BUMP_EVENTS}/draft-0001-abcdef`);
    assert.equal(data.status, 'pending');
    assert.equal(data.opportunityCreated, true);
    assert.equal(data.town, 'Buffalo');
    assert.equal(data.repName, 'Riley Rep', 'signed-in profile name wins');
    assert.equal(data.householdSize, 3);
    assert.equal(data.estimatedTierLabel, 'Comfort Home (est.)');
    assert.equal(data.assistanceYes, false);
    assert.equal(String(data.name).includes('@everyone'), false);
    const text = JSON.stringify(data);
    assert.equal(text.includes('0100123'), false, 'no phone');
    assert.equal(text.includes(EMAIL), false, 'no email');
    assert.equal(text.includes('95000') || text.includes('95,000'), false, 'no income');
    for (const key of Object.keys(data)) {
      assert.ok(!/phone|email|income|address|zip/i.test(key), key);
    }
  });

  it('update of an existing opp writes an event with opportunityCreated false; repName falls back to the body', async () => {
    const t = harness({ user: { approved: true } });
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.opps.push({ id: 'opp-1', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-11-01T00:00:00Z', customFields: [] });
    await t.run(body({ repName: 'Body Rep' }));
    const event = t.ghlDb.docs.get(`${EMPOWER_BUMP_EVENTS}/draft-0001-abcdef`)?.data;
    assert.equal(event?.opportunityCreated, false);
    assert.equal(event?.outcome, 'updated');
    assert.equal(event?.repName, 'Body Rep');
    // A second visit with a new draft gets its own event.
    await t.run(body({ draftId: 'draft-0002-abcdef' }));
    assert.ok(t.ghlDb.docs.get(`${EMPOWER_BUMP_EVENTS}/draft-0002-abcdef`));
  });
});

describe('empower bump: no PII or secrets in logs', () => {
  it('logs and console never contain the homeowner name, phone, email, token, or income', async () => {
    const t = harness();
    await t.run(body({ annualHouseholdIncome: 61000 }));
    const failing = harness();
    failing.ghl.failOn = { method: 'PUT', pathPrefix: '/contacts/', status: 500 };
    seedContact(failing.ghl, { id: 'c1', phone: PHONE_E164 });
    await failing.run(body());
    const all = [...t.logs, ...failing.logs, ...consoleLines].join('\n');
    assert.ok(t.logs.length > 0);
    for (const needle of ['Jane', 'Neighbor', '0100123', EMAIL, FAKE_TOKEN, '61000', '123 Main']) {
      assert.equal(all.includes(needle), false, needle);
    }
  });
});

// ================================================================ Charles QA round (Nov 23)

describe('QA change 1: only an OPEN Empower+ opp is updated; otherwise create', () => {
  const closedOnly = (t: ReturnType<typeof harness>) => {
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.opps.push(
      { id: 'opp-won', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'won', updatedAt: '2026-11-22T00:00:00Z', customFields: [] },
      { id: 'opp-lost', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'lost', updatedAt: '2026-11-21T00:00:00Z', customFields: [] },
      { id: 'opp-abandoned', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'abandoned', updatedAt: '2026-11-20T00:00:00Z', customFields: [] },
    );
  };

  it('closed-only Empower+ opps: creates a new opp at Portal Creation Needed and never writes a closed one', async () => {
    const t = harness();
    closedOnly(t);
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(result.body && 'outcome' in result.body && result.body.outcome, 'created');
    assert.equal(t.ghl.count('POST', '/opportunities/'), 1);
    assert.equal((t.ghl.oppWrite()?.body as Record<string, unknown>).pipelineStageId, EMPOWER_CREATE_STAGE_ID);
    assert.equal(t.ghl.calls.some((c) => c.method === 'PUT' && c.path.startsWith('/opportunities/')), false);
  });

  it('open beats a more recently updated closed opp', async () => {
    const t = harness();
    closedOnly(t);
    t.ghl.opps.push({ id: 'opp-open', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-01-01T00:00:00Z', customFields: [] });
    const result = await t.run(body());
    assert.equal(result.body && 'opportunityId' in result.body && result.body.opportunityId, 'opp-open');
    assert.equal(t.ghl.count('POST', '/opportunities/'), 0);
    assert.equal(t.ghl.oppWrite()?.path, '/opportunities/opp-open');
  });

  it('several open opps: picks the most recently updated open one', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    for (const [id, at] of [['opp-a', '2026-11-01T00:00:00Z'], ['opp-c', '2026-11-15T00:00:00Z'], ['opp-b', '2026-11-10T00:00:00Z']]) {
      t.ghl.opps.push({ id, contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: at, customFields: [] });
    }
    const result = await t.run(body());
    assert.equal(result.body && 'opportunityId' in result.body && result.body.opportunityId, 'opp-c');
    assert.equal(t.ghl.writes().filter((c) => c.path.startsWith('/opportunities/')).length, 1);
  });

  it('no Empower+ opp at all (existing contact): creates one', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    const result = await t.run(body());
    assert.equal(result.body && 'outcome' in result.body && result.body.outcome, 'created');
    assert.equal(t.ghl.count('POST', '/opportunities/'), 1);
  });

  it('an opp with no status is ambiguous: 502, no create, no update', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.opps.push({ id: 'opp-x', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: '', updatedAt: '2026-11-01T00:00:00Z', customFields: [] });
    const result = await t.run(body());
    assert.equal(result.status, 502);
    assert.equal(t.ghl.writes().filter((c) => c.path.startsWith('/opportunities/')).length, 0);
  });
});

describe('QA change 2: official Empower Tier write protection (contact and opp)', () => {
  function seeded(contactTier: string | null, oppTier: string | null, optionalFields?: EmpowerBumpOptionalFields) {
    const t = harness({ optionalFields });
    seedContact(t.ghl, {
      id: 'c1',
      phone: PHONE_E164,
      customFields: contactTier ? [{ id: GHL_FIELDS.contactEmpowerTier, value: contactTier }] : [],
    });
    t.ghl.opps.push({
      id: 'opp-1',
      contactId: 'c1',
      pipelineId: EMPOWER_PIPELINE_ID,
      status: 'open',
      updatedAt: '2026-11-01T00:00:00Z',
      customFields: oppTier ? [{ id: GHL_FIELDS.opportunityEmpowerTier, fieldValueString: oppTier }] : [],
    });
    return t;
  }
  const contactTier = (t: ReturnType<typeof harness>) => fieldValue(t.ghl.contactWrite(), GHL_FIELDS.contactEmpowerTier);
  const oppTier = (t: ReturnType<typeof harness>) => fieldValue(t.ghl.oppWrite(), GHL_FIELDS.opportunityEmpowerTier);
  const programs = { assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[0]] };

  it('empty (existing contact + open opp): Tier 3 estimate writes Tier 3 on both', async () => {
    const t = seeded(null, null);
    assert.equal((await t.run(body({ estimatedBand: 'tier3' }))).status, 200);
    assert.equal(contactTier(t), 'Tier 3');
    assert.equal(oppTier(t), 'Tier 3');
  });

  it('empty (new contact + new opp): Tier 1 estimate writes Tier 1 on both', async () => {
    const t = harness();
    await t.run(body({ estimatedBand: 'tier1' }));
    assert.equal(contactTier(t), 'Tier 1');
    assert.equal(oppTier(t), 'Tier 1');
  });

  it('Tier 1 existing + Tier 3 estimate: never downgraded on either', async () => {
    const t = seeded('Tier 1', 'Tier 1');
    await t.run(body({ estimatedBand: 'tier3' }));
    assert.equal(contactTier(t), undefined);
    assert.equal(oppTier(t), undefined);
    assert.match(t.ghl.note(), /Official Empower Tier left unchanged at Tier 1/);
  });

  it('Tier 1 existing + Tier 3 from an exact income: still not downgraded', async () => {
    const t = seeded('Tier 1', 'Tier 1');
    await t.run(body({ householdSize: 1, estimatedBand: 'tier1', annualHouseholdIncome: 50000 }));
    assert.equal(contactTier(t), undefined);
    assert.equal(oppTier(t), undefined);
  });

  it('Tier 3 existing + assistance: upgraded to Tier 1 on both', async () => {
    const t = seeded('Tier 3', 'Tier 3');
    await t.run(body({ estimatedBand: 'comfort_home', ...programs }));
    assert.equal(contactTier(t), 'Tier 1');
    assert.equal(oppTier(t), 'Tier 1');
  });

  it('Tier 1 existing + assistance: no redundant write', async () => {
    const t = seeded('Tier 1', 'Tier 1');
    await t.run(body(programs));
    assert.equal(contactTier(t), undefined);
    assert.equal(oppTier(t), undefined);
  });

  it('Tier 3 existing + non-assistance Tier 1 estimate: not overwritten on either', async () => {
    const t = seeded('Tier 3', 'Tier 3');
    await t.run(body({ estimatedBand: 'tier1' }));
    assert.equal(contactTier(t), undefined);
    assert.equal(oppTier(t), undefined);
    assert.match(t.ghl.note(), /Official Empower Tier left unchanged at Tier 3/);
  });

  for (const band of ['comfort_home', 'not_sure'] as const) {
    it(`${band} over empty: official tier not written on either; estimate goes to the band field and note`, async () => {
      const t = seeded(null, null, { estimatedBandFieldId: 'bandFieldId01' });
      await t.run(body({ estimatedBand: band }));
      assert.equal(contactTier(t), undefined);
      assert.equal(oppTier(t), undefined);
      const label = band === 'comfort_home' ? 'Comfort Home (est.)' : 'Not sure';
      assert.equal(fieldValue(t.ghl.contactWrite(), 'bandFieldId01'), label);
      assert.ok(t.ghl.note().includes(`Estimated band: ${label}`));
    });
  }

  it('contact and opp are judged separately (contact empty, opp Tier 1, Tier 3 estimate)', async () => {
    const t = seeded(null, 'Tier 1');
    await t.run(body({ estimatedBand: 'tier3' }));
    assert.equal(contactTier(t), 'Tier 3');
    assert.equal(oppTier(t), undefined);
  });

  it('a protected tier still records the estimate in the band field', async () => {
    const t = seeded('Tier 1', 'Tier 1', { estimatedBandFieldId: 'bandFieldId01' });
    await t.run(body({ estimatedBand: 'tier3' }));
    assert.equal(fieldValue(t.ghl.contactWrite(), 'bandFieldId01'), 'Tier 3 (est.)');
  });

  it('unreadable matched contact is 502 (cannot see the current tier), no writes', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.failOn = { method: 'GET', pathPrefix: '/contacts/c1', status: 404 };
    const result = await t.run(body());
    assert.equal(result.status, 502);
    assert.deepEqual(t.ghl.writes(), []);
  });
});

describe('QA change 3: opp-id marker for ghl-sync', () => {
  it('a bump-created opp gets empower_bump_opps_v1/{oppId} before the event and receipt', async () => {
    const t = harness();
    const result = await t.run(body());
    const oppId = result.body && 'opportunityId' in result.body ? result.body.opportunityId : '';
    const marker = t.ghlDb.docs.get(`empower_bump_opps_v1/${oppId}`)?.data;
    assert.equal(marker?.opportunityId, oppId);
    assert.equal(marker?.draftId, 'draft-0001-abcdef');
    assert.deepEqual(Object.keys(marker ?? {}).sort(), ['contactId', 'createdAt', 'createdAtMs', 'draftId', 'opportunityId', 'source']);
    const order = t.ghlDb.writes.filter((w) => w.startsWith('create'));
    assert.deepEqual(order, [`create empower_bump_opps_v1/${oppId}`, 'create empower_bump_events_v1/draft-0001-abcdef']);
    assert.equal(t.raydarDb.docs.get(`${EMPOWER_BUMP_RECEIPTS}/uid-rep-1_draft-0001-abcdef`)?.data.opportunityId, oppId);
  });

  it('an update of an existing opp writes no marker', async () => {
    const t = harness();
    seedContact(t.ghl, { id: 'c1', phone: PHONE_E164 });
    t.ghl.opps.push({ id: 'opp-ghl', contactId: 'c1', pipelineId: EMPOWER_PIPELINE_ID, status: 'open', updatedAt: '2026-11-01T00:00:00Z', customFields: [] });
    await t.run(body());
    assert.equal([...t.ghlDb.docs.keys()].some((k) => k.startsWith('empower_bump_opps_v1/')), false);
    assert.equal(t.ghlDb.docs.get(`${EMPOWER_BUMP_EVENTS}/draft-0001-abcdef`)?.data.opportunityId, 'opp-ghl');
  });

  it('marker write failure after the GHL create is 502 with no event and no receipt', async () => {
    const t = harness();
    t.ghlDb.failCreateIn.add('empower_bump_opps_v1');
    const result = await t.run(body());
    assert.equal(result.status, 502);
    assert.equal(t.raydarDb.docs.size, 0);
    assert.equal(t.ghlDb.docs.size, 0);
  });
});

// ================================================================ ship round: scheduling-manager destination

// Obvious fakes. Never real webhook URLs.
const OVERRIDE_HOOK = 'https://discord.com/api/webhooks/111111111111111111/fakeOverrideTokenForTests';
const SCHEDULING_ENV_HOOK = 'https://discord.com/api/webhooks/222222222222222222/fakeSchedulingEnvTokenForTests';
const SCHEDULING_STORED_HOOK = 'https://discord.com/api/webhooks/333333333333333333/fakeSchedulingStoredTokenForTests';
const FMA_LIKE_HOOK = 'https://discord.com/api/webhooks/444444444444444444/fakeFmaOpportunityTokenForTests';
const ALL_HOOKS = [OVERRIDE_HOOK, SCHEDULING_ENV_HOOK, SCHEDULING_STORED_HOOK, FMA_LIKE_HOOK];

function eventDoc(t: ReturnType<typeof harness>, draftId = 'draft-0001-abcdef') {
  return t.ghlDb.docs.get(`${EMPOWER_BUMP_EVENTS}/${draftId}`)?.data;
}

function assertNoWebhookLeak(t: ReturnType<typeof harness>, result: unknown) {
  const haystack = [JSON.stringify(result), ...t.logs, ...consoleLines, JSON.stringify([...t.ghlDb.docs.values()]), JSON.stringify([...t.raydarDb.docs.values()])].join('\n');
  for (const hook of ALL_HOOKS) {
    assert.equal(haystack.includes(hook), false, `webhook leaked (${maskWebhookUrl(hook)})`);
    assert.equal(haystack.includes(new URL(hook).pathname.split('/')[4]), false, 'webhook token leaked');
  }
}

describe('ship: Discord destination is the scheduling-manager webhook', () => {
  it('setting only (adminSettings/global.notificationWebhook): posts one Empower Plus bump there', async () => {
    const t = harness({ storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(t.discordPosts.length, 1);
    assert.equal(t.discordPosts[0].url, SCHEDULING_STORED_HOOK);
    assert.equal(eventDoc(t)?.status, 'sent');
    assert.equal(eventDoc(t)?.deliverySource, 'scheduling_manager');
    assert.ok(t.logs.some((l) => l.startsWith('discord_sent {"source":"scheduling_manager"}')));
    assertNoWebhookLeak(t, result);
  });

  it('scheduling env (DISCORD_NOTIFICATION_WEBHOOK_URL) wins over the stored setting, same as the scheduling route', async () => {
    const t = harness({ schedulingEnvWebhook: SCHEDULING_ENV_HOOK, storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    await t.run(body());
    assert.deepEqual(t.discordPosts.map((p) => p.url), [SCHEDULING_ENV_HOOK]);
  });

  it('override (DISCORD_EMPOWER_BUMP_WEBHOOK_URL) wins when set', async () => {
    const t = harness({ overrideWebhook: OVERRIDE_HOOK, schedulingEnvWebhook: SCHEDULING_ENV_HOOK, storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    const result = await t.run(body());
    assert.deepEqual(t.discordPosts.map((p) => p.url), [OVERRIDE_HOOK]);
    assert.equal(eventDoc(t)?.deliverySource, 'override');
    assertNoWebhookLeak(t, result);
  });

  it('neither configured: 200, no post, event stays pending, status-only warning', async () => {
    const t = harness();
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(t.discordPosts.length, 0);
    assert.equal(eventDoc(t)?.status, 'pending');
    assert.equal(eventDoc(t)?.deliveryReason, 'not_configured');
    assert.ok(t.logs.includes('discord_pending {"reason":"not_configured"}'));
  });

  it('invalid override: no post and no fallback to the scheduling webhook', async () => {
    for (const bad of ['https://example.com/api/webhooks/111111111111111111/fakeToken0001', 'http://discord.com/api/webhooks/111111111111111111/fakeToken0001', 'not a url']) {
      const t = harness({ overrideWebhook: bad, storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
      const result = await t.run(body());
      assert.equal(result.status, 200);
      assert.equal(t.discordPosts.length, 0, bad);
      assert.equal(eventDoc(t)?.status, 'pending');
      assert.equal(eventDoc(t)?.deliveryReason, 'invalid_override');
    }
  });

  it('invalid stored scheduling webhook: no post, pending', async () => {
    const t = harness({ storedSchedulingWebhook: 'https://hooks.slack.com/services/T000/B000/fakeSlackToken' });
    await t.run(body());
    assert.equal(t.discordPosts.length, 0);
    assert.equal(eventDoc(t)?.deliveryReason, 'invalid_scheduling_webhook');
  });

  it('no fallback to the FMA/opportunity webhook, even if it is in the environment', async () => {
    const before = process.env.DISCORD_OPPORTUNITY_WEBHOOK_URL;
    process.env.DISCORD_OPPORTUNITY_WEBHOOK_URL = FMA_LIKE_HOOK;
    try {
      const t = harness();
      await t.run(body());
      assert.equal(t.discordPosts.length, 0);
      assert.equal(eventDoc(t)?.status, 'pending');
    } finally {
      if (before === undefined) delete process.env.DISCORD_OPPORTUNITY_WEBHOOK_URL;
      else process.env.DISCORD_OPPORTUNITY_WEBHOOK_URL = before;
    }
    const src = await import('node:fs').then((fs) => [
      fs.readFileSync(new URL('../app/utils/server/empowerBumpDiscord.ts', import.meta.url), 'utf8'),
      fs.readFileSync(new URL('../app/api/empower-bump/route.ts', import.meta.url), 'utf8'),
    ].join('\n'));
    assert.equal(/process\.env\.DISCORD_OPPORTUNITY_WEBHOOK_URL|process\.env\.DISCORD_WEBHOOK_URL/.test(src), false);
  });

  it('embed: title/content Empower Plus bump, includes address/phone/email and income selection, no raw income, mentions off', async () => {
    const t = harness({ storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    await t.run(body({ name: 'Jane @everyone <@123> Neighbor', annualHouseholdIncome: 95000, assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[0]] }));
    const posted = t.discordPosts[0].body as {
      content: string;
      allowed_mentions: unknown;
      embeds: Array<{ title: string; fields: Array<{ name: string; value: string }>; footer: { text: string } }>;
    };
    assert.equal(posted.content, 'Empower Plus bump');
    assert.equal(posted.embeds[0].title, 'Empower Plus bump');
    assert.deepEqual(posted.allowed_mentions, { parse: [] });
    assert.deepEqual(posted.embeds[0].fields.map((f) => f.name), [
      'Customer', 'Town', 'Rep', 'Household size', 'Household income selection', 'Government assistance',
      'Address', 'Phone', 'Email',
    ]);
    const values = Object.fromEntries(posted.embeds[0].fields.map((f) => [f.name, f.value]));
    const expectedIncome = incomeSelectionLabel({ band: 'tier1', county: 'Erie', householdSize: 3, categorical: true });
    assert.equal(values.Town, 'Buffalo');
    assert.equal(values.Rep, 'Riley Rep');
    assert.equal(values['Household size'], '3');
    assert.equal(values['Household income selection'], expectedIncome);
    assert.equal(expectedIncome, 'Tier 1 (assistance program)');
    assert.equal(values['Household income selection'].includes('$'), false);
    const event = eventDoc(t);
    assert.equal(event?.estimatedTierLabel, 'Tier 1 (est.)');
    assert.equal(JSON.stringify(event).includes('$'), false);
    assert.equal(JSON.stringify(event).includes('assistance program'), false);
    assert.equal(values['Government assistance'], 'Yes');
    assert.equal(values.Address, '123 Main St, Buffalo NY 14201');
    assert.equal(values.Phone, PHONE);
    assert.equal(values.Email, EMAIL);
    assert.equal(values.Customer.includes('@everyone') || values.Customer.includes('<@'), false);
    assert.match(posted.embeds[0].footer.text, /^Opportunity ID: opp-/);
    const text = JSON.stringify(posted);
    assert.equal(text.includes('Opportunity Created'), false);
    assert.equal(text.includes('95000') || text.includes('95,000'), false, 'no raw annual income');
    assert.equal(text.includes(PHONE), true);
    assert.equal(text.includes(EMAIL), true);
    assert.equal(text.includes('123 Main St'), true);
  });

  it('a request missing email and address still posts, with those fields marked not provided', async () => {
    const t = harness({ storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    const result = await t.run(body({ email: undefined, address: undefined, city: undefined, zip: undefined, town: 'Buffalo' }));
    assert.equal(result.status, 200);
    const posted = t.discordPosts[0].body as { embeds: Array<{ fields: Array<{ name: string; value: string }> }> };
    const values = Object.fromEntries(posted.embeds[0].fields.map((f) => [f.name, f.value]));
    assert.equal(values.Address, 'Not provided');
    assert.equal(values.Email, 'Not provided');
    assert.equal(values.Phone, PHONE);
    assert.equal(values.Town, 'Buffalo');
  });

  it('replay of the same draft posts nothing; a new draft on the same opp posts again', async () => {
    const t = harness({ storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    await t.run(body());
    await t.run(body());
    assert.equal(t.discordPosts.length, 1);
    await t.run(body({ draftId: 'draft-0002-abcdef' }));
    assert.equal(t.discordPosts.length, 2);
  });

  it('Discord failure: still 200, event marked error, not retried on replay', async () => {
    const t = harness({ storedSchedulingWebhook: SCHEDULING_STORED_HOOK, discordStatus: 500 });
    const result = await t.run(body());
    assert.equal(result.status, 200);
    assert.equal(eventDoc(t)?.status, 'error');
    assert.equal(eventDoc(t)?.deliveryResponseStatus, 500);
    await t.run(body());
    assert.equal(t.discordPosts.length, 1);
  });

  it('flag off: no webhook resolution and no post', async () => {
    const t = harness({ enabled: false, storedSchedulingWebhook: SCHEDULING_STORED_HOOK });
    assert.equal((await t.run(body())).status, 503);
    assert.equal(t.discordPosts.length, 0);
  });

  it('the poster refuses a non-Discord URL without a network call', async () => {
    let calls = 0;
    const post = createEmpowerBumpDiscordPoster(async () => { calls += 1; return { ok: true, status: 204 }; });
    const res = await post('https://example.com/api/webhooks/123456789012345678/fakeTokenForTests', {} as never);
    assert.deepEqual(res, { ok: false, status: 0 });
    assert.equal(calls, 0);
  });

  it('maskWebhookUrl never includes the token', () => {
    const masked = maskWebhookUrl(SCHEDULING_STORED_HOOK);
    assert.equal(masked.includes('fakeSchedulingStoredTokenForTests'), false);
    assert.equal(masked.includes('333333333333333333'), false);
  });
});

describe('ship: GHL option strings match the live fields exactly', () => {
  // Read-only GET of the live field definitions, Nov 23 2026 (location MMKRDviKggXzlcHQTnvZ):
  // XjggiTCTlHa4ru4LPBO8 Empower Estimated Band (SINGLE_OPTIONS),
  // yU1QwUWE8XkBX1mNuSr5 Empower Government Assistance (MULTIPLE_OPTIONS).
  it('Empower Estimated Band options', () => {
    assert.deepEqual(Object.values(ESTIMATED_BAND_LABELS), ['Tier 1 (est.)', 'Tier 3 (est.)', 'Comfort Home (est.)', 'Not sure']);
  });

  it('Empower Government Assistance options', () => {
    assert.deepEqual([...ASSISTANCE_PROGRAMS], [
      'HEAP (Home Energy Assistance Program)',
      'SNAP (Supplemental Nutrition Assistance Program/Food Stamps)/SNAP NYC',
      'SSI (Supplemental Security Income)',
      'TANF (Temporary Assistance for Needy Families)',
      'Weatherization Assistance Program',
      'Public Assistance',
    ]);
  });

  it('with the ship ids configured, the exact option strings are written', async () => {
    const t = harness({ optionalFields: { estimatedBandFieldId: 'XjggiTCTlHa4ru4LPBO8', assistanceFieldId: 'yU1QwUWE8XkBX1mNuSr5' } });
    await t.run(body({ assistanceNone: false, assistancePrograms: [ASSISTANCE_PROGRAMS[1], ASSISTANCE_PROGRAMS[5]] }));
    assert.equal(fieldValue(t.ghl.contactWrite(), 'XjggiTCTlHa4ru4LPBO8'), 'Tier 1 (est.)');
    assert.deepEqual(fieldValue(t.ghl.contactWrite(), 'yU1QwUWE8XkBX1mNuSr5'), [ASSISTANCE_PROGRAMS[1], ASSISTANCE_PROGRAMS[5]]);
    const none = harness({ optionalFields: { assistanceFieldId: 'yU1QwUWE8XkBX1mNuSr5' } });
    await none.run(body());
    assert.deepEqual(fieldValue(none.ghl.contactWrite(), 'yU1QwUWE8XkBX1mNuSr5'), [], 'None clears the multi-select');
  });
});
