import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST, runtime } from '../app/api/empower-bump/route.ts';

describe('POST /api/empower-bump route', () => {
  it('is a Node runtime route', () => {
    assert.equal(runtime, 'nodejs');
  });

  for (const value of [undefined, '', '0', 'false']) {
    it(`EMPOWER_BUMP_ENABLED=${JSON.stringify(value)} returns 503 before auth or Firestore`, async () => {
      const previous = process.env.EMPOWER_BUMP_ENABLED;
      const fetchBefore = globalThis.fetch;
      let fetched = 0;
      globalThis.fetch = (async () => { fetched += 1; throw new Error('no network in tests'); }) as typeof fetch;
      if (value === undefined) delete process.env.EMPOWER_BUMP_ENABLED;
      else process.env.EMPOWER_BUMP_ENABLED = value;
      try {
        const response = await POST(new NextRequest('https://example.test/api/empower-bump', {
          method: 'POST',
          headers: { Authorization: 'Bearer fake', 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftId: 'draft-0001-abcdef' }),
        }));
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'Empower bump is not configured.' });
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
        assert.equal(fetched, 0);
      } finally {
        globalThis.fetch = fetchBefore;
        if (previous === undefined) delete process.env.EMPOWER_BUMP_ENABLED;
        else process.env.EMPOWER_BUMP_ENABLED = previous;
      }
    });
  }
});
