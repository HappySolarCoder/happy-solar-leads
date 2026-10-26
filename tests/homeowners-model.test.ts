import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMunicipality, normalizeStreet } from '../app/homeowners/model';

describe('homeowner place names', () => {
  it('matches Street with ST and leaves municipality suffixes alone', () => {
    assert.equal(normalizeStreet('123 Main Street'), normalizeStreet('123 MAIN ST'));
    assert.equal(normalizeStreet('123 Main St.'), '123 main st');
    assert.equal(normalizeStreet('9 Side Avenue'), normalizeStreet('9 side ave'));
    assert.equal(normalizeMunicipality('St Louis'), 'st louis');
    assert.equal(normalizeMunicipality('Phoenix'), normalizeMunicipality('PHOENIX'));
  });
});
