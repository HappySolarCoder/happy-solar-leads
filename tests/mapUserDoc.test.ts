import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapUserDoc, mapUserDocs, parseUserDate } from '../app/utils/mapUserDoc.ts';

function docSnap(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

describe('parseUserDate (PR 125 Timestamp / Date / string parse)', () => {
  it('uses toDate() when present (Firestore Timestamp)', () => {
    const when = new Date('2026-03-01T12:00:00.000Z');
    const parsed = parseUserDate({ toDate: () => when }, new Date());
    assert.equal(parsed.toISOString(), when.toISOString());
  });

  it('accepts a Date', () => {
    const when = new Date('2026-04-02T08:00:00.000Z');
    const parsed = parseUserDate(when, new Date());
    assert.equal(parsed.toISOString(), when.toISOString());
  });

  it('accepts an ISO string', () => {
    const parsed = parseUserDate('2026-05-03T09:30:00.000Z', new Date());
    assert.equal(parsed.toISOString(), '2026-05-03T09:30:00.000Z');
  });

  it('uses fallback when missing', () => {
    const fallback = new Date('2020-01-01T00:00:00.000Z');
    assert.equal(parseUserDate(undefined, fallback), fallback);
    assert.equal(parseUserDate(null, fallback), fallback);
    assert.equal(parseUserDate(undefined, undefined), undefined);
  });

  it('does not throw when toDate exists but throws — normalizes to fallback', () => {
    const fallback = new Date('2021-01-01T00:00:00.000Z');
    const parsed = parseUserDate({
      toDate: () => {
        throw new Error('toDate is not a function');
      },
    }, fallback);
    assert.equal(parsed, fallback);
  });
});

describe('mapUserDoc', () => {
  it('does not throw on string createdAt and still produces a user', () => {
    const user = mapUserDoc(docSnap('u-string', {
      name: 'String Date User',
      email: 'string@example.com',
      role: 'setter',
      createdAt: '2026-06-01T00:00:00.000Z',
    }));
    assert.equal(user.id, 'u-string');
    assert.equal(user.name, 'String Date User');
    assert.ok(user.createdAt instanceof Date);
    assert.equal(user.createdAt.toISOString(), '2026-06-01T00:00:00.000Z');
  });

  it('accepts Date createdAt', () => {
    const when = new Date('2026-07-01T00:00:00.000Z');
    const user = mapUserDoc(docSnap('u-date', {
      name: 'Date User',
      createdAt: when,
    }));
    assert.equal(user.id, 'u-date');
    assert.equal(user.createdAt.toISOString(), when.toISOString());
  });

  it('defaults createdAt when missing', () => {
    const before = Date.now();
    const user = mapUserDoc(docSnap('u-missing', { name: 'Missing Date User' }));
    assert.equal(user.id, 'u-missing');
    assert.ok(user.createdAt instanceof Date);
    assert.ok(user.createdAt.getTime() >= before);
  });

  it('accepts Timestamp-like {toDate} createdAt', () => {
    const when = new Date('2026-08-01T00:00:00.000Z');
    const user = mapUserDoc(docSnap('u-ts', {
      name: 'Timestamp User',
      createdAt: { toDate: () => when },
    }));
    assert.equal(user.id, 'u-ts');
    assert.equal(user.createdAt.toISOString(), when.toISOString());
  });

  it('preserves features.proximityEnforcement from the Firestore doc', () => {
    const user = mapUserDoc(docSnap('u-features', {
      name: 'Flag User',
      role: 'setter',
      createdAt: '2026-08-01T00:00:00.000Z',
      features: { proximityEnforcement: false },
    }));
    assert.equal(user.features?.proximityEnforcement, false);
  });

  it('parses lastLogin and approvalRequestedAt the same way', () => {
    const last = new Date('2026-08-10T00:00:00.000Z');
    const approval = new Date('2026-08-11T00:00:00.000Z');
    const user = mapUserDoc(docSnap('u-extra', {
      name: 'Extra Dates',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastLogin: { toDate: () => last },
      approvalRequestedAt: '2026-08-11T00:00:00.000Z',
    }));
    assert.equal(user.lastLogin?.toISOString(), last.toISOString());
    assert.equal(user.approvalRequestedAt?.toISOString(), approval.toISOString());
  });

  it('the old getAllUsers call throws on string createdAt (cause verified)', () => {
    const data = { createdAt: '2026-06-01T00:00:00.000Z' };
    assert.throws(
      () => data.createdAt?.toDate() || new Date(),
      (err: unknown) => err instanceof TypeError && /toDate is not a function/.test(String(err)),
    );
  });
});

describe('mapUserDocs', () => {
  it('maps a mixed collection and does not empty the roster', () => {
    const when = new Date('2026-08-15T00:00:00.000Z');
    const users = mapUserDocs([
      docSnap('ok-string', { name: 'A', createdAt: '2026-08-15T00:00:00.000Z' }),
      docSnap('ok-date', { name: 'B', createdAt: when }),
      docSnap('ok-missing', { name: 'C' }),
      docSnap('ok-ts', { name: 'D', createdAt: { toDate: () => when } }),
    ]);
    assert.equal(users.length, 4);
    assert.deepEqual(users.map(u => u.id), ['ok-string', 'ok-date', 'ok-missing', 'ok-ts']);
    for (const user of users) {
      assert.ok(user.createdAt instanceof Date);
    }
  });

  it('skips one unreadable doc and keeps the rest', () => {
    const users = mapUserDocs([
      docSnap('good-1', { name: 'Keep', createdAt: '2026-08-15T00:00:00.000Z' }),
      {
        id: 'bad',
        data: () => {
          throw new Error('corrupt doc');
        },
      },
      docSnap('good-2', { name: 'Also keep', createdAt: new Date('2026-08-16T00:00:00.000Z') }),
    ]);
    assert.deepEqual(users.map(u => u.id), ['good-1', 'good-2']);
  });

  it('normalizes a throwing toDate on one field and still produces that user', () => {
    const users = mapUserDocs([
      docSnap('throws-todate', {
        name: 'Still here',
        createdAt: {
          toDate: () => {
            throw new TypeError('toDate is not a function');
          },
        },
      }),
      docSnap('neighbor', { name: 'Neighbor', createdAt: '2026-08-17T00:00:00.000Z' }),
    ]);
    assert.equal(users.length, 2);
    assert.equal(users[0].id, 'throws-todate');
    assert.equal(users[0].name, 'Still here');
    assert.ok(users[0].createdAt instanceof Date);
    assert.equal(users[1].id, 'neighbor');
  });
});
