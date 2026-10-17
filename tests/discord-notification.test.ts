import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicAdminSettings } from '../app/utils/publicAdminSettings.ts';
import {
  DISCORD_NOTIFICATION_LIMIT,
  DISCORD_NOTIFICATION_WINDOW_MS,
  DISCORD_TEST_CONTENT,
  handleDiscordNotification,
  isDiscordWebhookUrl,
  isTestAccount,
  resolveDiscordWebhookUrl,
  selectWebhookUrl,
  type DiscordNotificationDeps,
  type DiscordPostBody,
} from '../app/utils/server/discordNotification.ts';

const FAKE_WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/fakeTokenForTests';
const STORED_WEBHOOK = 'https://discord.com/api/webhooks/223456789012345678/storedTokenForTests';

const scheduling = {
  kind: 'scheduling',
  name: 'Ada Lovelace',
  address: '1 Main St',
  city: 'Rochester',
  state: 'ny',
  zip: '14618',
  phone: '555-0100',
  email: 'ada@example.com',
  estimatedBill: '150',
  notes: 'Call after 5',
  solarScore: 80,
  solarSunshineHours: 1200.4,
  solarMaxPanels: 20,
  hasSouthFacingRoof: true,
};

function harness(overrides: {
  uid?: string;
  user?: Record<string, unknown>;
  exists?: boolean;
  authorization?: string | null;
  verifyError?: unknown;
  webhook?: string | null;
  postOk?: boolean;
  now?: () => number;
} = {}) {
  const posts: Array<{ url: string; body: DiscordPostBody }> = [];
  const revoked: boolean[] = [];
  const uid = overrides.uid ?? 'uid-approved';
  const rateLimitStore = new Map<string, number[]>();
  const deps: DiscordNotificationDeps = {
    verifyIdToken: async (_token, checkRevoked) => {
      revoked.push(checkRevoked);
      if (overrides.verifyError) throw overrides.verifyError;
      return { uid, email: 'rep@company.com' };
    },
    getUser: async () => ({
      exists: overrides.exists !== false,
      data: overrides.exists === false
        ? undefined
        : (overrides.user ?? {
          role: 'setter',
          name: 'Riley Rep',
          email: 'rep@company.com',
          approved: true,
          isActive: true,
        }),
    }),
    resolveWebhookUrl: async () => (overrides.webhook === undefined ? FAKE_WEBHOOK : overrides.webhook),
    postDiscord: async (url, body) => {
      posts.push({ url, body });
      return { ok: overrides.postOk !== false, status: overrides.postOk === false ? 500 : 204 };
    },
    now: overrides.now ?? (() => 1_700_000_000_000),
    rateLimitStore,
  };

  return {
    posts,
    revoked,
    run: (body: unknown, authorization?: string | null) => handleDiscordNotification({
      authorization: authorization === undefined
        ? (overrides.authorization === undefined ? 'Bearer good-token' : overrides.authorization)
        : authorization,
      body,
      deps,
    }),
  };
}

describe('discord notification auth', () => {
  it('posts a scheduling request for an approved active user', async () => {
    const test = harness();
    const result = await test.run(scheduling);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true });
    assert.deepEqual(test.revoked, [true]);
    assert.equal(test.posts.length, 1);
    assert.equal(test.posts[0].url, FAKE_WEBHOOK);
    assert.deepEqual(Object.keys(test.posts[0].body).sort(), ['allowed_mentions', 'content']);
    assert.deepEqual(test.posts[0].body.allowed_mentions, { parse: [] });
    assert.match(test.posts[0].body.content, /Riley Rep/);
    assert.match(test.posts[0].body.content, /Ada Lovelace/);
    assert.match(test.posts[0].body.content, /Rochester, NY 14618/);
    assert.match(test.posts[0].body.content, /555-0100/);
    assert.match(test.posts[0].body.content, /Solar Score: 80\/100/);
    assert.equal(JSON.stringify(result).includes('fakeToken'), false);
    assert.equal(test.posts[0].body.content.includes(FAKE_WEBHOOK), false);
  });

  it('rejects a missing or rejected token', async () => {
    const missing = harness({ authorization: null });
    const missingResult = await missing.run(scheduling);
    assert.equal(missingResult.status, 401);
    assert.equal(missing.posts.length, 0);

    const rejected = harness({ verifyError: { code: 'auth/id-token-revoked' } });
    const rejectedResult = await rejected.run(scheduling);
    assert.equal(rejectedResult.status, 401);
    assert.equal(rejected.posts.length, 0);
  });

  it('rejects an inactive account and a test account', async () => {
    const inactive = harness({
      uid: 'uid-inactive',
      user: { role: 'setter', name: 'Inactive', email: 'rep@company.com', isActive: false, approved: true },
    });
    const inactiveResult = await inactive.run(scheduling);
    assert.equal(inactiveResult.status, 403);
    assert.equal(inactiveResult.body.error, 'This account is not approved.');
    assert.equal(inactive.posts.length, 0);

    const byEmail = harness({
      uid: 'uid-test-email',
      user: { role: 'admin', name: 'Test Admin', email: 'Evan@Test.com', approved: true, isActive: true },
    });
    const emailResult = await byEmail.run(scheduling);
    assert.equal(emailResult.status, 403);
    assert.equal(emailResult.body.error, 'Test accounts cannot send notifications.');
    assert.equal(byEmail.posts.length, 0);

    const byId = harness({
      uid: 'user-test-1',
      user: { role: 'setter', name: 'Seed', email: 'seed@company.com', approved: true, isActive: true },
    });
    assert.equal((await byId.run(scheduling)).status, 403);
    assert.equal(byId.posts.length, 0);

    const byFlag = harness({
      uid: 'uid-flagged',
      user: { role: 'setter', name: 'Flagged', email: 'flag@company.com', isTest: true, approved: true, isActive: true },
    });
    assert.equal((await byFlag.run({ kind: 'test' })).status, 403);
    assert.equal(byFlag.posts.length, 0);
  });

  it('still sends when the lead email is a test domain and the rep is real', async () => {
    const test = harness({ uid: 'uid-real-rep' });
    const result = await test.run({ ...scheduling, email: 'homeowner@test.com' });
    assert.equal(result.status, 200);
    assert.match(test.posts[0].body.content, /homeowner@test.com/);
  });
});

describe('discord notification payload', () => {
  it('accepts the admin test payload and nothing else on that kind', async () => {
    const test = harness({ uid: 'uid-test-kind' });
    const result = await test.run({ kind: 'test' });
    assert.equal(result.status, 200);
    assert.equal(test.posts[0].body.content, DISCORD_TEST_CONTENT);

    const extra = harness({ uid: 'uid-test-extra' });
    const rejected = await extra.run({ kind: 'test', content: 'custom' });
    assert.equal(rejected.status, 400);
    assert.equal(extra.posts.length, 0);
  });

  it('rejects unknown fields, missing fields, and non-objects', async () => {
    const cases: unknown[] = [
      null,
      [],
      'hello',
      { kind: 'slack' },
      { ...scheduling, content: 'override the message' },
      { ...scheduling, embeds: [{ title: 'nope' }] },
      { ...scheduling, senderName: 'Spoofed' },
      { ...scheduling, notificationWebhook: FAKE_WEBHOOK },
      { kind: 'scheduling', address: '1 Main', city: 'Rochester', state: 'NY', zip: '14618', phone: '555' },
      { ...scheduling, zip: '14' },
      { ...scheduling, state: 'New York' },
      { ...scheduling, notes: 'x'.repeat(801) },
    ];

    for (const body of cases) {
      const test = harness({ uid: `uid-bad-${cases.indexOf(body)}` });
      const result = await test.run(body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(test.posts.length, 0);
      assert.equal(JSON.stringify(result).includes('fakeToken'), false);
    }
  });

  it('does not spend a rate-limit slot on an invalid payload', async () => {
    const test = harness({ uid: 'uid-invalid-then-ok' });
    for (let i = 0; i < DISCORD_NOTIFICATION_LIMIT + 2; i += 1) {
      const rejected = await test.run({ kind: 'scheduling' });
      assert.equal(rejected.status, 400);
    }
    const result = await test.run(scheduling);
    assert.equal(result.status, 200);
    assert.equal(test.posts.length, 1);
  });
});

describe('discord notification webhook selection', () => {
  it('prefers the env var and does not read the stored value once env is set', async () => {
    let reads = 0;
    const selected = await resolveDiscordWebhookUrl({
      envValue: `  ${FAKE_WEBHOOK}  `,
      readStoredWebhook: async () => {
        reads += 1;
        return STORED_WEBHOOK;
      },
    });
    assert.equal(selected, FAKE_WEBHOOK);
    assert.equal(reads, 0);
    assert.equal(selectWebhookUrl(FAKE_WEBHOOK, STORED_WEBHOOK), FAKE_WEBHOOK);
  });

  it('falls back to the stored admin setting only when env is unset', async () => {
    let reads = 0;
    const selected = await resolveDiscordWebhookUrl({
      envValue: '   ',
      readStoredWebhook: async () => {
        reads += 1;
        return `  ${STORED_WEBHOOK}  `;
      },
    });
    assert.equal(selected, STORED_WEBHOOK);
    assert.equal(reads, 1);
    assert.equal(selectWebhookUrl(undefined, ''), null);
    assert.equal(selectWebhookUrl(undefined, 12), null);
  });

  it('accepts only https Discord webhook URLs', () => {
    const path = '/api/webhooks/123456789012345678/fakeTokenForTests';
    for (const host of [
      'discord.com',
      'canary.discord.com',
      'ptb.discord.com',
      'discordapp.com',
      'canary.discordapp.com',
      'ptb.discordapp.com',
    ]) {
      assert.equal(isDiscordWebhookUrl(`https://${host}${path}`), true, host);
    }
    for (const host of [
      'discord.com.evil.com',
      'evilcanary.discord.com',
      'canary.discord.com.evil.com',
      'notdiscord.com',
      'www.discord.com',
      'evil.discord.com',
    ]) {
      assert.equal(isDiscordWebhookUrl(`https://${host}${path}`), false, host);
    }
    assert.equal(isDiscordWebhookUrl('http://discord.com/api/webhooks/123456789012345678/fakeTokenForTests'), false);
    assert.equal(isDiscordWebhookUrl('http://canary.discord.com/api/webhooks/123456789012345678/fakeTokenForTests'), false);
    assert.equal(isDiscordWebhookUrl(`${FAKE_WEBHOOK}/slack`), false);
    assert.equal(isDiscordWebhookUrl('https://hooks.slack.com/services/T00/B00/secret'), false);
    assert.equal(isDiscordWebhookUrl('https://user:pass@discord.com/api/webhooks/123456789012345678/fakeTokenForTests'), false);
    assert.equal(isDiscordWebhookUrl(`${FAKE_WEBHOOK}?wait=true`), false);
  });

  it('does not post when the webhook is missing or not a Discord webhook', async () => {
    const missing = harness({ uid: 'uid-no-hook', webhook: null });
    assert.equal((await missing.run(scheduling)).status, 503);
    assert.equal(missing.posts.length, 0);

    const slack = harness({ uid: 'uid-slack-hook', webhook: 'https://hooks.slack.com/services/T00/B00/secret' });
    const result = await slack.run({ kind: 'test' });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'Discord notifications are not configured.');
    assert.equal(slack.posts.length, 0);
    assert.equal(JSON.stringify(result).includes('hooks.slack.com'), false);
  });

  it('rate limits each user and then allows a later window', async () => {
    let now = 5_000;
    const test = harness({ uid: 'uid-rate', now: () => now });
    for (let i = 0; i < DISCORD_NOTIFICATION_LIMIT; i += 1) {
      assert.equal((await test.run({ kind: 'test' })).status, 200);
    }
    const blocked = await test.run({ kind: 'test' });
    assert.equal(blocked.status, 429);
    assert.equal(test.posts.length, DISCORD_NOTIFICATION_LIMIT);

    now += DISCORD_NOTIFICATION_WINDOW_MS;
    assert.equal((await test.run({ kind: 'test' })).status, 200);
    assert.equal(test.posts.length, DISCORD_NOTIFICATION_LIMIT + 1);
  });

  it('returns 502 without echoing the webhook when Discord rejects the post', async () => {
    const test = harness({ uid: 'uid-upstream', postOk: false });
    const result = await test.run({ kind: 'test' });
    assert.equal(result.status, 502);
    assert.equal(JSON.stringify(result).includes('fakeToken'), false);
  });
});

describe('admin settings shown to the client', () => {
  it('drops the webhook field', () => {
    const secret = 'https://discord.com/api/webhooks/999/secret-token-value';
    const pub = toPublicAdminSettings({
      schedulingManagerPhone: '(716) 272-9889',
      notificationType: 'discord',
      notificationWebhook: secret,
      updatedBy: 'admin-uid',
    });
    assert.deepEqual(pub, {
      schedulingManagerPhone: '(716) 272-9889',
      notificationType: 'discord',
    });
    assert.equal(JSON.stringify(pub).includes('secret-token'), false);
    assert.equal(JSON.stringify(pub).includes('discord.com'), false);
  });
});

describe('isTestAccount', () => {
  it('matches the seeded test users and explicit flags only', () => {
    assert.equal(isTestAccount('uid-1', { email: 'rep@company.com' }), false);
    assert.equal(isTestAccount('uid-1', { email: 'john@test.com' }), true);
    assert.equal(isTestAccount('uid-1', { accountType: 'Test' }), true);
    assert.equal(isTestAccount('uid-1', { testAccount: true, email: 'rep@company.com' }), true);
    assert.equal(isTestAccount('user-test-4', { email: 'rep@company.com' }), true);
  });
});
