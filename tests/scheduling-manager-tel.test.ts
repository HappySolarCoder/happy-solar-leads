import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_SCHEDULING_MANAGER_PHONE,
  schedulingManagerTelDigits,
} from '../app/utils/schedulingManagerTel.ts';

describe('scheduling manager tel digits', () => {
  it('keeps the historical fallback number', () => {
    assert.equal(FALLBACK_SCHEDULING_MANAGER_PHONE, '(716) 272-9889');
    assert.equal(schedulingManagerTelDigits(null), '7162729889');
    assert.equal(schedulingManagerTelDigits(undefined), '7162729889');
    assert.equal(schedulingManagerTelDigits(''), '7162729889');
    assert.equal(schedulingManagerTelDigits('   '), '7162729889');
    assert.equal(schedulingManagerTelDigits('not-a-phone'), '7162729889');
  });

  it('strips formatting without dropping a country code', () => {
    assert.equal(schedulingManagerTelDigits('(716) 272-9889'), '7162729889');
    assert.equal(schedulingManagerTelDigits('+1 (716) 272-9889'), '17162729889');
  });
});
