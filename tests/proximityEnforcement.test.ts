import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isProximityEnforcementEnabled,
  isProximityRequired,
  PROXIMITY_MAX_DISTANCE_METERS,
} from '../app/utils/proximityEnforcement.ts';
import type { User } from '../app/types/index.ts';

function user(partial: Partial<User> & { id: string; role: User['role'] }): User {
  return {
    name: partial.name || partial.id,
    email: `${partial.id}@example.com`,
    color: '#111111',
    createdAt: new Date('2026-01-01'),
    isActive: true,
    ...partial,
  };
}

describe('proximity enforcement flag', () => {
  it('keeps the historical 50m threshold', () => {
    assert.equal(PROXIMITY_MAX_DISTANCE_METERS, 50);
  });

  it('defaults ON when features is missing', () => {
    const setter = user({ id: 's1', role: 'setter' });
    assert.equal(isProximityEnforcementEnabled(setter), true);
    assert.equal(isProximityRequired(setter), true);
  });

  it('defaults ON when the flag is true', () => {
    const setter = user({
      id: 's2',
      role: 'setter',
      features: { proximityEnforcement: true },
    });
    assert.equal(isProximityRequired(setter), true);
  });

  it('skips the gate only when the flag is explicitly false', () => {
    const breen = user({
      id: 'william-breen',
      name: 'William Breen',
      role: 'setter',
      features: { proximityEnforcement: false },
    });
    assert.equal(isProximityEnforcementEnabled(breen), false);
    assert.equal(isProximityRequired(breen), false);
  });

  it('still skips the gate for exempt roles even if the flag is missing', () => {
    assert.equal(isProximityRequired(user({ id: 'a1', role: 'admin' })), false);
    assert.equal(isProximityRequired(user({ id: 'c1', role: 'closer' })), false);
  });

  it('does not grant a skip to managers unless the flag is false', () => {
    const manager = user({ id: 'm1', role: 'manager' });
    assert.equal(isProximityRequired(manager), true);
    assert.equal(
      isProximityRequired({ ...manager, features: { proximityEnforcement: false } }),
      false,
    );
  });

  it('treats a missing user as not gated (same as LeadMap before a session exists)', () => {
    assert.equal(isProximityRequired(null), false);
    assert.equal(isProximityRequired(undefined), false);
    assert.equal(isProximityEnforcementEnabled(null), true);
  });

  it('honors a sales role if present on the record', () => {
    assert.equal(isProximityRequired({ role: 'sales' }), true);
    assert.equal(
      isProximityRequired({ role: 'sales', features: { proximityEnforcement: false } }),
      false,
    );
  });
});
