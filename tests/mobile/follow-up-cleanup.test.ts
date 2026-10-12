import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../../app/types';
import { followUpCleanupPatch, isOwnFollowUp } from '../../app/mobile/_lib/followUps';
import { deleteUserTerritories } from '../../app/mobile/territories/deleteTerritories';
import type { ManagedTerritory } from '../../app/utils/territoryManager';

const lead = { id:'home', status:'go-back', claimedBy:'rep', assignedTo:'rep', goBackScheduledBy:'rep',
  goBackScheduledDate:new Date('2026-10-13T12:00:00Z'), goBackScheduledTime:'12:00',
  dispositionedAt:new Date('2026-10-11T12:00:00Z'), notes:'Keep notes', goBackNotes:'Keep return notes',
  dispositionHistory:[{userId:'rep',userName:'Rep',disposition:'Go Back',timestamp:new Date('2026-10-11T12:00:00Z')}],
  appointmentOutcome:'show', knockGpsLat:43, knockGpsLng:-77 } as Lead;

test('follow-ups belong to their scheduler, with explicit legacy owner fallback and no admin-wide access', () => {
  assert.equal(isOwnFollowUp(lead,'rep'),true);
  assert.equal(isOwnFollowUp(lead,'admin'),false);
  assert.equal(isOwnFollowUp({...lead,goBackScheduledBy:'someone-else'},'rep'),false);
  assert.equal(isOwnFollowUp({...lead,goBackScheduledBy:undefined},'rep'),true);
  assert.equal(isOwnFollowUp({...lead,goBackScheduledBy:undefined,claimedBy:undefined},'rep'),true);
  assert.equal(isOwnFollowUp({...lead,goBackScheduledBy:undefined,claimedBy:'other'},'rep'),false);
  assert.equal(isOwnFollowUp({...lead,historicalTerritoryPin:true},'rep'),false);
  assert.equal(isOwnFollowUp({...lead,goBackScheduledDate:null},'rep'),false);
});
test('cleanup cancels only the reminder; knock history, status, notes, GPS and appointment outcome remain intact', () => {
  const before=structuredClone(lead), patch=followUpCleanupPatch(lead,lead,'rep');
  assert.deepEqual(patch,{goBackScheduledDate:null,goBackScheduledTime:''});
  const after={...lead,...patch};
  for(const key of Object.keys(lead)) if(!['goBackScheduledDate','goBackScheduledTime'].includes(key))
    assert.deepEqual(after[key as keyof Lead],before[key as keyof Lead]);
  assert.equal(isOwnFollowUp(after,'rep'),false);
  assert.deepEqual(lead,before);
});
test('cleanup preserves a concurrently rescheduled, reassigned or dispositioned lead and handles server Timestamps', () => {
  for(const update of [
    {goBackScheduledDate:new Date('2026-10-14T12:00:00Z')}, {goBackScheduledTime:'13:00'},
    {goBackScheduledBy:'other'}, {claimedBy:'other'}, {assignedTo:'other'}, {status:'not-home'},
    {dispositionedAt:new Date('2026-10-12T12:00:00Z')}, {goBackScheduledDate:null},
  ]) assert.equal(followUpCleanupPatch({...lead,...update},lead,'rep'),null);
  assert.equal(followUpCleanupPatch(lead,lead,'other'),null);
  const server={...lead,goBackScheduledDate:{toMillis:()=>lead.goBackScheduledDate!.getTime()},
    dispositionedAt:{toMillis:()=>lead.dispositionedAt!.getTime()}} as unknown as Lead;
  assert.ok(followUpCleanupPatch(server,lead,'rep'));
});

const areas = ['a','b','c','other'].map(id=>({id,version:'v1',userId:id==='other'?'other':'rep'} as ManagedTerritory));
test('bulk territory deletion uses deployed archive action, stops on failure, and retries the same operation id', async () => {
  const operations=new Map<string,string>(), calls:Record<string,unknown>[]=[];
  const removed:string[]=[];
  let fail=true;
  const request=async (body:Record<string,unknown>)=>{
    assert.equal(body.action,'archive');
    assert.deepEqual(Object.keys(body).sort(),['action','id','requestId','version']);
    calls.push(body);
    if(body.id==='b'&&fail)throw Error('Lost acknowledgement');
  };
  await assert.rejects(deleteUserTerritories('rep',areas,request,operations,id=>removed.push(id)),/Lost acknowledgement/);
  assert.deepEqual(removed,['a']);
  assert.deepEqual(calls.map(c=>c.id),['a','b']);
  const failedId=calls[1].requestId;
  fail=false;
  await deleteUserTerritories('rep',areas.filter(a=>!removed.includes(a.id)),request,operations,id=>removed.push(id));
  assert.equal(calls[2].requestId,failedId);
  assert.deepEqual(removed,['a','b','c']);
  assert.equal(operations.size,0);
  assert.ok(calls.every(c=>c.version==='v1'&&c.id!=='other'));
});
