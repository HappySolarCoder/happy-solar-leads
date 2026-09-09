import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DISPOSITIONS,
  HOUSE_FOR_SALE_DISPOSITION_ID,
  GO_BACK_DISPOSITION_ID,
  KNOCK_STATUS_IDS,
  isScheduledGoBackStatus,
  isScheduledGoBackLead,
  mergeMissingDefaultDispositions,
  findMissingDefaultDispositions,
} from '../app/types/disposition.ts';
import { STATUS_COLORS, STATUS_LABELS } from '../app/types/index.ts';

describe('House for Sale disposition', () => {
  it('is a default disposition with a distinct sky pin from Go Back', () => {
    const house = DEFAULT_DISPOSITIONS.find((d) => d.id === HOUSE_FOR_SALE_DISPOSITION_ID);
    const goBack = DEFAULT_DISPOSITIONS.find((d) => d.id === GO_BACK_DISPOSITION_ID);
    assert.ok(house);
    assert.equal(house?.name, 'House for Sale');
    assert.equal(house?.countsAsDoorKnock, true);
    assert.ok(house?.color);
    assert.notEqual(house?.color, goBack?.color);
    assert.notEqual(house?.icon, goBack?.icon);
  });

  it('uses snake/kebab id matching other knock statuses', () => {
    assert.equal(HOUSE_FOR_SALE_DISPOSITION_ID, 'house-for-sale');
    assert.ok((KNOCK_STATUS_IDS as readonly string[]).includes('house-for-sale'));
    assert.ok((KNOCK_STATUS_IDS as readonly string[]).includes('go-back'));
  });

  it('shares go-back list membership with Go Back', () => {
    assert.equal(isScheduledGoBackStatus('go-back'), true);
    assert.equal(isScheduledGoBackStatus('house-for-sale'), true);
    assert.equal(isScheduledGoBackStatus('not-home'), false);
    assert.equal(isScheduledGoBackStatus(undefined), false);

    assert.equal(isScheduledGoBackLead({ status: 'house-for-sale', goBackScheduledDate: new Date() }), true);
    assert.equal(isScheduledGoBackLead({ status: 'house-for-sale' }), false);
    assert.equal(isScheduledGoBackLead({ status: 'go-back', goBackScheduledDate: new Date() }), true);
    assert.equal(isScheduledGoBackLead({ status: 'not-home', goBackScheduledDate: new Date() }), false);
  });

  it('merges into existing Firestore disposition lists without duplicating by id or name', () => {
    const existing = DEFAULT_DISPOSITIONS.filter((d) => d.id !== 'house-for-sale');
    const missing = findMissingDefaultDispositions(existing);
    assert.equal(missing.some((d) => d.id === 'house-for-sale'), true);

    const merged = mergeMissingDefaultDispositions(existing);
    assert.equal(merged.filter((d) => d.id === 'house-for-sale').length, 1);
    assert.equal(mergeMissingDefaultDispositions(merged).length, merged.length);

    const alreadyNamed = [
      ...existing,
      {
        id: 'custom-hfs',
        name: 'House for Sale',
        color: '#000',
        icon: 'home',
        countsAsDoorKnock: true,
        order: 99,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    assert.equal(findMissingDefaultDispositions(alreadyNamed).length, 0);
  });

  it('exposes label and pin color on the legacy status maps', () => {
    assert.equal(STATUS_LABELS['house-for-sale'], 'House for Sale');
    assert.equal(STATUS_COLORS['house-for-sale'], '#0ea5e9');
    assert.notEqual(STATUS_COLORS['house-for-sale'], STATUS_COLORS['go-back']);
  });
});
