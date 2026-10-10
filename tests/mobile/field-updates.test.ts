import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../../app/types/index.ts';
import { nearbyReturns, personalOutcomeLeads, outcomeKey, doorstepMemory, scheduledMinutes } from '../../app/mobile/_lib/fieldUpdates.ts';
const now = new Date('2026-10-09T21:10:00Z'); // 5:10pm New York, independent of device timezone
const lead: Lead = { id:'a', name:'Sample', address:'1 Sample', city:'Rochester', state:'NY', zip:'', status:'go-back', createdAt:now, assignedTo:'rep', lat:43.15, lng:-77.6, goBackScheduledDate:new Date('2026-10-09T04:00:00Z'), goBackScheduledTime:'17:00' };
const gps = {lat:43.15, lng:-77.6, accuracy:15, timestamp:now.getTime()};
test('returns respect Eastern agreed time and a one-hour window, never early or next day', () => {
  assert.equal(nearbyReturns([lead], 'rep', gps, now).length, 1);
  for (const time of ['2026-10-09T20:59:00Z','2026-10-09T22:00:00Z','2026-10-10T21:10:00Z']) {
    const at = new Date(time);
    assert.equal(nearbyReturns([lead], 'rep', {...gps, timestamp:at.getTime()}, at).length, 0);
  }
  assert.equal(scheduledMinutes('5:00 PM'), 1020);
  assert.equal(scheduledMinutes('12:00 AM'), 0);
  assert.equal(scheduledMinutes('25:00'), null);
  assert.equal(scheduledMinutes('17:99'), null);
});
test('reminders suppress unassigned, reassigned, completed, anytime and stale/poor GPS records', () => {
  const excluded = [
    {...lead, assignedTo:'other'}, {...lead, claimedBy:'other'}, {...lead, historicalTerritoryPin:true},
    {...lead, status:'not-interested'}, {...lead, appointmentOutcome:'Sold'}, {...lead, appointmentOutcome:'Confirmed'},
    {...lead, goBackScheduledTime:undefined}, {...lead, lat:44}, {...lead, lng:NaN},
  ];
  assert.equal(nearbyReturns(excluded, 'rep', gps, now).length, 0);
  assert.equal(nearbyReturns([lead], 'rep', {...gps, accuracy:300}, now).length, 0);
  assert.equal(nearbyReturns([lead], 'rep', {...gps, timestamp:now.getTime()-180000}, now).length, 0);
  assert.equal(nearbyReturns([lead], 'rep', null, now).length, 0);
});
test('winter returns respect Eastern standard time', () => {
  const at = new Date('2026-12-09T22:05:00Z');
  assert.equal(nearbyReturns([{...lead, goBackScheduledDate:new Date('2026-12-09T05:00:00Z')}], 'rep', {...gps, timestamp:at.getTime()}, at).length, 1);
});
test('personal results exclude other reps even when an admin downloaded them', () => {
  const sold = {...lead, appointmentOutcome:'Sold'};
  assert.deepEqual(personalOutcomeLeads([sold, {...sold,id:'b',claimedBy:'other'}, {...sold,id:'c',assignedTo:'other'}, {...sold,id:'d',historicalTerritoryPin:true}], 'rep').map(l => l.id), ['a']);
  assert.equal(personalOutcomeLeads([{...lead, ghlStatus:'won'}], 'rep').length,0);
});
test('repeat CRM sync does not become unseen again; a changed outcome does', () => {
  const sold = {...lead, appointmentOutcome:'Sold'};
  assert.equal(outcomeKey(sold), outcomeKey({...sold, ghlLastUpdatedAt:new Date()}));
  assert.notEqual(outcomeKey(sold), outcomeKey({...sold, appointmentOutcome:'Cancelled'}));
});
test('memory preserves literal notes and does not invent a conversation or sale', () => {
  assert.equal(doorstepMemory(lead).conversation, 'No conversation notes yet.');
  assert.equal(doorstepMemory({...lead,notes:'Asked for spouse to be home'}).conversation, 'Asked for spouse to be home');
  assert.equal(doorstepMemory({...lead,appointmentOutcome:'Sold'}).next,'Sold — no return knock needed.');
  assert.equal(doorstepMemory({...lead,appointmentOutcome:'Custom pending'}).outcome,'Custom pending');
});
