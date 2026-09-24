import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../app/types/index.ts';
import type { Territory } from '../app/types/territory.ts';
import {
  collectHistoricalStatusIds,
  isAppointmentSetOrSoldLead,
  mergeHistoricalTerritoryPins,
  selectHistoricalTerritoryPins,
  pastPinPopupLines,
  toPublicHistoricalPin,
} from '../app/utils/historicalTerritoryPins.ts';

const myTerritory: Territory = {
  id: 't-me',
  userId: 'me',
  userName: 'Me',
  userColor: '#3b82f6',
  polygon: [
    { lat: 43.2, lng: -77.7 },
    { lat: 43.2, lng: -77.5 },
    { lat: 43.1, lng: -77.5 },
    { lat: 43.1, lng: -77.7 },
  ],
  leadIds: [],
  createdAt: new Date(0),
  createdBy: 'admin',
};

const otherTerritory: Territory = {
  ...myTerritory,
  id: 't-other',
  userId: 'other',
  polygon: [
    { lat: 44.2, lng: -77.7 },
    { lat: 44.2, lng: -77.5 },
    { lat: 44.1, lng: -77.5 },
    { lat: 44.1, lng: -77.7 },
  ],
};

function lead(partial: Partial<Lead> & Pick<Lead, 'id' | 'status'>): Lead {
  return {
    name: partial.name || partial.id,
    address: partial.address || '1 Main St',
    city: 'Rochester',
    state: 'NY',
    zip: '14604',
    createdAt: new Date(0),
    lat: 43.15,
    lng: -77.6,
    claimedBy: 'other-rep',
    ...partial,
  };
}

describe('isAppointmentSetOrSoldLead', () => {
  it('accepts Appointment Set and Sold outcomes, including Sale!', () => {
    assert.equal(isAppointmentSetOrSoldLead({ status: 'appointment' }), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'sale' }), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'sold' }), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'Appointment Set' }), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'Sale!' }), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: '', disposition: 'Sold' }), true);
  });

  it('rejects other dispositions, including House for Sale', () => {
    for (const status of ['not-home', 'interested', 'not-interested', 'go-back', 'house-for-sale', 'claimed', 'unclaimed']) {
      assert.equal(isAppointmentSetOrSoldLead({ status, disposition: 'Sold' }), false, status);
    }
    assert.equal(isAppointmentSetOrSoldLead({ status: 'House for Sale' }), false);
  });

  it('accepts a custom disposition id only when that id is in the allowed set', () => {
    const extra = new Set(['custom-sold']);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'custom-sold' }, extra), true);
    assert.equal(isAppointmentSetOrSoldLead({ status: 'custom-sold' }), false);
  });
});

describe('collectHistoricalStatusIds', () => {
  it('includes built-in ids and a custom Sold disposition, not House for Sale', () => {
    const ids = collectHistoricalStatusIds([
      { id: 'custom-sold', name: 'Sold' },
      { id: 'house-for-sale', name: 'House for Sale' },
      { id: 'not-home', name: 'Not Home' },
    ]);
    assert.ok(ids.includes('appointment'));
    assert.ok(ids.includes('sale'));
    assert.ok(ids.includes('custom-sold'));
    assert.equal(ids.includes('house-for-sale'), false);
    assert.equal(ids.includes('not-home'), false);
  });
});

describe('selectHistoricalTerritoryPins', () => {
  const extra = new Set(['custom-sold']);
  const territories = [myTerritory, otherTerritory];

  it('keeps another rep’s Appointment Set and Sold pins inside my polygon', () => {
    const pins = selectHistoricalTerritoryPins(
      [
        lead({ id: 'appt', status: 'appointment' }),
        lead({ id: 'sold', status: 'sale', disposition: 'Sale!' }),
        lead({ id: 'custom', status: 'custom-sold', disposition: 'Sold' }),
      ],
      'me',
      territories,
      extra,
    );
    assert.deepEqual(pins.map((pin) => pin.id).sort(), ['appt', 'custom', 'sold']);
  });

  it('drops other outcomes, pins outside my territory, and my own pins', () => {
    const pins = selectHistoricalTerritoryPins(
      [
        lead({ id: 'not-home', status: 'not-home' }),
        lead({ id: 'interested', status: 'interested' }),
        lead({ id: 'go-back', status: 'go-back' }),
        lead({ id: 'house', status: 'house-for-sale' }),
        lead({ id: 'outside', status: 'appointment', lat: 44.15, lng: -77.6 }),
        lead({ id: 'mine-claimed', status: 'appointment', claimedBy: 'me' }),
        lead({ id: 'mine-assigned', status: 'sale', claimedBy: 'other-rep', assignedTo: 'me' }),
        lead({ id: 'no-point', status: 'appointment', lat: undefined, lng: undefined }),
      ],
      'me',
      territories,
      extra,
    );
    assert.deepEqual(pins, []);
  });

  it('returns nothing when the viewer has no territory polygon', () => {
    const pins = selectHistoricalTerritoryPins(
      [lead({ id: 'appt', status: 'appointment' })],
      'me',
      [otherTerritory],
    );
    assert.deepEqual(pins, []);
  });
});

describe('mergeHistoricalTerritoryPins', () => {
  it('leaves an existing own pin unchanged and appends only new past pins', () => {
    const own = lead({ id: 'mine', status: 'appointment', claimedBy: 'me', historicalTerritoryPin: undefined });
    const duplicate = toPublicHistoricalPin(lead({ id: 'mine', status: 'appointment', claimedBy: 'me' }));
    const past = toPublicHistoricalPin(lead({ id: 'past', status: 'sale' }));
    const merged = mergeHistoricalTerritoryPins([own], [duplicate, past], 'me');
    assert.equal(merged.length, 2);
    assert.equal(merged[0], own);
    assert.equal(merged[0].historicalTerritoryPin, undefined);
    assert.equal(merged[1].id, 'past');
    assert.equal(merged[1].historicalTerritoryPin, true);
  });
});

describe('toPublicHistoricalPin', () => {
  it('keeps the door and who set it, and omits contact fields and user ids', () => {
    const pin = toPublicHistoricalPin(lead({
      id: 'past',
      status: 'appointment',
      phone: '555-0100',
      email: 'a@b.com',
      notes: 'secret',
      claimedBy: 'other-rep',
      assignedTo: 'other-rep',
      disposition: 'Appointment Set',
      dispositionHistory: [{
        disposition: 'Appointment Set',
        timestamp: new Date('2026-09-03T16:00:00Z'),
        userId: 'other-rep',
        userName: 'Alex Setter',
      }],
    }));
    assert.equal(pin.historicalTerritoryPin, true);
    assert.equal(pin.historicalSetByName, 'Alex Setter');
    assert.equal(pin.appointmentSetAt?.toISOString(), '2026-09-03T16:00:00.000Z');
    assert.equal(pin.disposition, 'Appointment Set');
    assert.equal(pin.address, '1 Main St');
    assert.equal((pin as Lead & { phone?: string }).phone, undefined);
    assert.equal((pin as Lead & { email?: string }).email, undefined);
    assert.equal((pin as Lead & { notes?: string }).notes, undefined);
    assert.equal((pin as Lead & { claimedBy?: string }).claimedBy, undefined);
    assert.equal((pin as Lead & { assignedTo?: string }).assignedTo, undefined);
    assert.equal((pin as Lead & { dispositionHistory?: unknown }).dispositionHistory, undefined);
    assert.equal(JSON.stringify(pin).includes('other-rep'), false);
  });

  it('uses the appointment-set history entry, not a later outcome', () => {
    const pin = toPublicHistoricalPin(lead({
      id: 'past',
      status: 'sale',
      disposition: 'Sold',
      dispositionedAt: new Date('2026-09-10T16:00:00Z'),
      dispositionHistory: [
        {
          disposition: 'Sold',
          timestamp: new Date('2026-09-10T16:00:00Z'),
          userId: 'rep-2',
          userName: 'Later Person',
        },
        {
          disposition: 'Appointment Set',
          timestamp: new Date('2026-09-03T16:00:00Z'),
          userId: 'rep-1',
          userName: 'Alex Setter',
        },
      ],
    }));
    assert.equal(pin.appointmentSetAt?.toISOString(), '2026-09-03T16:00:00.000Z');
    assert.equal(pin.historicalSetByName, 'Alex Setter');
    assert.equal(pin.disposition, 'Sold');
    assert.deepEqual(pastPinPopupLines(pin), [
      'Appt set Sep 3, 2026',
      'Set by Alex Setter',
      'Sold',
    ]);
    assert.equal(JSON.stringify(pin).includes('rep-1'), false);
    assert.equal(JSON.stringify(pin).includes('rep-2'), false);
  });

  it('falls back to dispositionedAt and omits missing setter, disposition, and invalid dates', () => {
    const fallback = toPublicHistoricalPin(lead({
      id: 'fallback',
      status: 'appointment',
      dispositionedAt: new Date('2026-09-03T16:00:00Z'),
      dispositionHistory: [{
        disposition: 'Not Home',
        timestamp: new Date('2026-08-01T16:00:00Z'),
        userId: 'secret-id',
        userName: 'Wrong Person',
      }],
    }));
    assert.equal(fallback.appointmentSetAt?.toISOString(), '2026-09-03T16:00:00.000Z');
    assert.equal(fallback.historicalSetByName, undefined);
    assert.equal(fallback.disposition, undefined);
    assert.deepEqual(pastPinPopupLines(fallback), ['Appt set Sep 3, 2026']);
    assert.equal(JSON.stringify(fallback).includes('secret-id'), false);
    assert.equal(JSON.stringify(fallback).includes('Wrong Person'), false);

    const missing = toPublicHistoricalPin(lead({
      id: 'missing',
      status: 'sale',
      disposition: '   ',
      dispositionedAt: new Date('not-a-date'),
      dispositionHistory: [{
        disposition: 'Appointment Set',
        timestamp: new Date(0),
        userId: 'rep-1',
        userName: '   ',
      }],
    }));
    assert.equal(missing.appointmentSetAt, undefined);
    assert.equal(missing.historicalSetByName, undefined);
    assert.equal(missing.disposition, undefined);
    const lines = pastPinPopupLines(missing);
    assert.deepEqual(lines, []);
    assert.equal(lines.some((line) => line.includes('Invalid')), false);

    const blankName = pastPinPopupLines({
      disposition: 'Appointment Set',
      appointmentSetAt: new Date('2026-09-03T16:00:00Z'),
      historicalSetByName: '  ',
    });
    assert.deepEqual(blankName, ['Appt set Sep 3, 2026', 'Appointment Set']);
  });
});
