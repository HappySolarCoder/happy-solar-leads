import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  leadManagementBoundsFromView,
  loadLeadManagementPins,
  withLoadTimeout,
  type LeadManagementPinLoaders,
} from '../app/utils/leadManagementPins.ts';

function mockLoaders(overrides: Partial<LeadManagementPinLoaders> = {}): LeadManagementPinLoaders & {
  calls: { getLeadsInBounds: number; getLeadsInBoundsForUser: number; getLeadsForUserLimited: number };
} {
  const calls = { getLeadsInBounds: 0, getLeadsInBoundsForUser: 0, getLeadsForUserLimited: 0 };
  return {
    calls,
    getLeadsInBounds: async () => {
      calls.getLeadsInBounds += 1;
      return [{ id: 'admin-pin' } as any];
    },
    getLeadsInBoundsForUser: async () => {
      calls.getLeadsInBoundsForUser += 1;
      return [];
    },
    getLeadsForUserLimited: async () => {
      calls.getLeadsForUserLimited += 1;
      return [{ id: 'manager-pin' } as any];
    },
    ...overrides,
  };
}

const rochester = leadManagementBoundsFromView([43.1566, -77.6088], 11);

describe('leadManagementBoundsFromView', () => {
  it('uses a bounded Rochester box at default zoom 11', () => {
    assert.ok(rochester.south < 43.1566);
    assert.ok(rochester.north > 43.1566);
    assert.ok(rochester.west < -77.6088);
    assert.ok(rochester.east > -77.6088);
    assert.equal(rochester.maxLeads, 2000);
    assert.ok(rochester.north - rochester.south < 1);
  });
});

describe('loadLeadManagementPins', () => {
  it('admin uses lat-range getLeadsInBounds and never dumps getLeadsForUserLimited', async () => {
    const loaders = mockLoaders();
    const pins = await loadLeadManagementPins({ id: 'admin-1', role: 'admin' }, rochester, loaders);
    assert.equal(pins[0]?.id, 'admin-pin');
    assert.equal(loaders.calls.getLeadsInBounds, 1);
    assert.equal(loaders.calls.getLeadsInBoundsForUser, 0);
    assert.equal(loaders.calls.getLeadsForUserLimited, 0);
  });

  it('manager does not use the admin all-leads lat query', async () => {
    const loaders = mockLoaders();
    const pins = await loadLeadManagementPins({ id: 'mgr-1', role: 'manager' }, rochester, loaders);
    assert.equal(pins[0]?.id, 'manager-pin');
    assert.equal(loaders.calls.getLeadsInBounds, 0);
    assert.equal(loaders.calls.getLeadsInBoundsForUser, 1);
    assert.equal(loaders.calls.getLeadsForUserLimited, 1);
  });

  it('manager prefers viewport claimed/assigned pins when that query returns rows', async () => {
    const loaders = mockLoaders({
      getLeadsInBoundsForUser: async () => [{ id: 'viewport-pin' } as any],
    });
    const pins = await loadLeadManagementPins({ id: 'mgr-1', role: 'manager' }, rochester, loaders);
    assert.equal(pins[0]?.id, 'viewport-pin');
    assert.equal(loaders.calls.getLeadsForUserLimited, 0);
  });
});

describe('withLoadTimeout', () => {
  it('rejects when the awaited work never settles', async () => {
    await assert.rejects(
      () => withLoadTimeout(new Promise(() => {}), 'getLeadsAsync', 20),
      /getLeadsAsync timed out after 20ms/,
    );
  });

  it('resolves when the work finishes in time', async () => {
    const value = await withLoadTimeout(Promise.resolve('ok'), 'fast', 100);
    assert.equal(value, 'ok');
  });
});
