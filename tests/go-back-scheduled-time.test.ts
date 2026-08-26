import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatGoBackScheduledTime, formatTimeEST } from '../app/utils/timezone.ts';

describe('formatGoBackScheduledTime', () => {
  it('formats 24-hour afternoon values with pm', () => {
    assert.equal(formatGoBackScheduledTime('18:25'), '6:25pm');
    assert.equal(formatGoBackScheduledTime('18:25:00'), '6:25pm');
    assert.equal(formatGoBackScheduledTime('13:00'), '1:00pm');
  });

  it('formats morning 24-hour values with am', () => {
    assert.equal(formatGoBackScheduledTime('10:30'), '10:30am');
    assert.equal(formatGoBackScheduledTime('09:05'), '9:05am');
    assert.equal(formatGoBackScheduledTime('00:00'), '12:00am');
  });

  it('formats noon and midnight without shifting the clock face', () => {
    assert.equal(formatGoBackScheduledTime('12:00'), '12:00pm');
    assert.equal(formatGoBackScheduledTime('12:30'), '12:30pm');
    assert.equal(formatGoBackScheduledTime('00:30'), '12:30am');
  });

  it('normalizes already-labeled 12-hour strings without changing the hour', () => {
    assert.equal(formatGoBackScheduledTime('10:30 AM'), '10:30am');
    assert.equal(formatGoBackScheduledTime('10:30AM'), '10:30am');
    assert.equal(formatGoBackScheduledTime('2:00 PM'), '2:00pm');
    assert.equal(formatGoBackScheduledTime('6:25pm'), '6:25pm');
  });

  it('does not convert a wall-clock string through America/New_York (no hour shift)', () => {
    // formatTimeEST treats date-less strings as UTC and would shift on this host.
    // Go-back times are already the intended ET clock face.
    const shifted = formatTimeEST('2026-08-26T18:25:00');
    assert.notEqual(formatGoBackScheduledTime('18:25'), shifted);
    assert.equal(formatGoBackScheduledTime('18:25'), '6:25pm');
    assert.equal(formatGoBackScheduledTime('10:30'), '10:30am');
  });

  it('leaves empty and unrecognized values unchanged for callers', () => {
    assert.equal(formatGoBackScheduledTime(undefined), '');
    assert.equal(formatGoBackScheduledTime(''), '');
    assert.equal(formatGoBackScheduledTime('   '), '');
    assert.equal(formatGoBackScheduledTime('Anytime'), 'Anytime');
  });
});
