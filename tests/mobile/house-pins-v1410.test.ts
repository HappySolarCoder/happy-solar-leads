import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../../app/types';
import { groupHouseLeads, houseHistory, eventMillis } from '../../app/homeowners/houseIdentity';
import { buildHouseIndex, mergeHomeowners, type Homeowner } from '../../app/homeowners/model';
import { fieldPinArtwork } from '../../app/utils/fieldPin';

const lead=(id:string, day:number, patch:Partial<Lead>={}):Lead=>({id,address:'91 Edgebrook Lane',city:'Irondequoit',state:'NY',zip:'',name:'Test',status:'not-home',lat:43.2,lng:-77.6,createdAt:new Date(0),dispositionedAt:new Date(`2026-10-${day}T12:00:00Z`),dispositionHistory:[{disposition:'Not Home',timestamp:new Date(`2026-10-${day}T12:00:00Z`),userId:'rep',userName:'Rep'}],...patch});
test('four visits collapse with homeowners off; postal-town aliases and full addresses retain latest outcome',()=>{
  const rows=[lead('one',10),lead('two',11,{address:'91 Edgebrook Ln, Irondequoit, NY'}),lead('three',12,{city:'Rochester',lat:43.2001}),lead('four',13,{status:'not-interested'})];
  const before=JSON.stringify(rows), grouped=groupHouseLeads(rows), merged=mergeHomeowners([],buildHouseIndex(rows));
  assert.equal(grouped.pins.length,1);assert.equal(grouped.pins[0].id,'four');assert.equal(grouped.pins[0].status,'not-interested');
  assert.equal(merged.hiddenLeadIds.size,3);assert.equal(JSON.stringify(rows),before);
  const home={id:'home',address:'91 Edgebrook Ln',addressNorm:'91 EDGEBROOK LN',municipality:'Irondequoit',state:'NY',lat:43.2002,lng:-77.6,ownerName:'Home Owner'} as Homeowner;
  const withHome=mergeHomeowners([home],buildHouseIndex(rows));assert.equal(withHome.gray.length,0);
  for(const row of rows)assert.equal(withHome.byLead.get(row.id)?.ownerName,'Home Owner');
});
test('neighboring houses and same street address in other towns/states are never swallowed',()=>{
  const rows=[lead('a',10),lead('neighbor',11,{address:'93 Edgebrook Ln',lat:43.20001}),lead('town',12,{city:'Buffalo',lat:42.8}),lead('state',13,{state:'AZ'})];
  assert.equal(groupHouseLeads(rows).pins.length,4);
  const home={id:'h',address:'95 Edgebrook Ln',municipality:'Irondequoit',state:'NY',lat:43.20001,lng:-77.6} as Homeowner;
  assert.equal(mergeHomeowners([home],buildHouseIndex(rows)).gray.length,1);
});
test('Date, serialized Timestamp and ISO times order visits; history dedupes replays but preserves separate knocks',()=>{
  const a=lead('a',10), b=lead('b',11); const at=eventMillis(b.dispositionedAt);
  b.dispositionedAt={seconds:at/1000,nanoseconds:0} as unknown as Date;
  b.dispositionHistory![0].timestamp=b.dispositionedAt;
  const c=lead('c',12,{dispositionedAt:'2026-10-12T12:00:00Z' as unknown as Date});
  const before=JSON.stringify([a,b,c]);
  assert.equal(groupHouseLeads([a,b,c]).pins[0].id,'c');
  const result=houseHistory([a,b,c,{...b,id:'replayed'}]);
  assert.equal(result.length,3);assert.equal(result[0].timestamp.toISOString(),'2026-10-12T12:00:00.000Z');
  assert.equal(JSON.stringify([a,b,c]),before);
});
test('only worked artwork doubles at every zoom; property/unworked dimensions remain unchanged',()=>{
  for(const [z,old,unworked] of [[11,6,6],[13,7,7],[16,7,7],[17,22,13.5],[18,24,21],[19,30,30]]){
    assert.equal(fieldPinArtwork(lead('a',10),undefined,z).size,old*2);
    assert.equal(fieldPinArtwork({...lead('a',10),status:'unclaimed'},undefined,z).size,unworked);
  }
});
