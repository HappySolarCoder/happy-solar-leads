import test from 'node:test';
import assert from 'node:assert/strict';
import type {Lead} from '../../app/types';
import {eventMillis,groupHouseLeads,latestVisit,latestKnockDisplay,mergeLeadSnapshots} from '../../app/homeowners/houseIdentity';
import {buildHouseIndex,mergeHomeowners,type Homeowner} from '../../app/homeowners/model';
import {matchesMapFilters} from '../../app/mobile/_lib/mapFilters';
import {DEFAULT_DISPOSITIONS} from '../../app/types/disposition';
import {mapLeadDoc} from '../../app/utils/firestore';

const time=(day:number)=>new Date(`2026-10-${day}T12:00:00Z`);
const lead=(id:string,day=10,patch:Partial<Lead>={}):Lead=>({id,address:'814 Example Road',city:'Rochester',state:'NY',zip:'',name:'Fictional',lat:43.1566,lng:-77.6088,createdAt:time(10),status:'not-home',disposition:'Not Home',dispositionedAt:time(day),dispositionHistory:[{disposition:'Not Home',timestamp:time(day),userId:'rep',userName:'Rep'}],...patch});
test('a stale personal/saved snapshot cannot overwrite a newer viewport knock, regardless of arrival order',()=>{
 const old=lead('one'),fresh=lead('one',14,{status:'not-interested',disposition:'Not Interested'});
 const before=JSON.stringify([old,fresh]);
 assert.equal(mergeLeadSnapshots([fresh],[old])[0],fresh);
 assert.equal(mergeLeadSnapshots([old],[fresh])[0],fresh);
 assert.equal(JSON.stringify([old,fresh]),before);
});
test('same-event summary does not discard full history and account caches keep separate record sets',()=>{
 const full=lead('one'),summary={...full,mobileSummary:true,dispositionHistory:[]} as Lead;
 assert.equal(mergeLeadSnapshots([full],[summary])[0],full);
 assert.equal(mergeLeadSnapshots([summary],[full])[0],full);
 assert.equal(mergeLeadSnapshots([lead('two')]).length,1);
});
test('latest history determines the displayed last knock when status is older, without changing the write target',()=>{
 const row=lead('original',10,{dispositionHistory:[{disposition:'Not Home',timestamp:time(10),userId:'rep',userName:'Rep'},{disposition:'Not Interested',timestamp:time(14),userId:'rep2',userName:'Rep 2'}]});
 const before=JSON.stringify(row),display=latestKnockDisplay(row);
 assert.equal(display.status,'not-interested');assert.equal(display.id,'original');
 assert.equal(latestVisit(row),time(14).getTime());
 assert.equal(matchesMapFilters(display,'all',['not-home'],DEFAULT_DISPOSITIONS),false);
 assert.equal(matchesMapFilters(display,'all',['not-interested'],DEFAULT_DISPOSITIONS),true);
 assert.equal(JSON.stringify(row),before);
});
test('configured disposition names map to existing IDs, while a newer canonical status wins over older history',()=>{
 const custom={...DEFAULT_DISPOSITIONS[2],id:'custom-dq',name:'Cannot Install'};
 const row=lead('one',10,{dispositionHistory:[{disposition:'Cannot Install',timestamp:time(14),userId:'rep',userName:'Rep'}]});
 assert.equal(latestKnockDisplay(row,[custom]).status,'custom-dq');
 const canonical=lead('two',15,{status:'interested',dispositionHistory:row.dispositionHistory});
 assert.equal(latestKnockDisplay(canonical,[custom]),canonical);
});
test('serialized Firestore timestamps survive document mapping; missing history dates never become now',()=>{
 const row=lead('one'); const seconds=time(14).getTime()/1000;
 const data={...row,dispositionedAt:{_seconds:seconds,_nanoseconds:500000000},dispositionHistory:[{disposition:'Not Home',timestamp:{seconds,nanoseconds:500000000}},{disposition:'Interested'}]};
 const mapped=mapLeadDoc({id:'one',data:()=>data});
 assert.equal(eventMillis(mapped.dispositionedAt),seconds*1000+500);
 assert.equal(eventMillis(mapped.dispositionHistory![0].timestamp),seconds*1000+500);
 assert.equal(eventMillis(mapped.dispositionHistory![1].timestamp),0);
});
test('postal alias bridge produces one latest pin regardless of page order; neighbor stays separate',()=>{
 const a=lead('a',10,{city:'Rochester',lat:43.1560});
 const b=lead('b',11,{city:'Irondequoit',lat:43.1565});
 const c=lead('c',14,{city:'Irondequoit',lat:43.1570,status:'not-interested'});
 const neighbor=lead('neighbor',15,{address:'816 Example Rd',lat:43.1565});
 for(const rows of [[a,c,b],[c,b,a],[b,a,c],[c,a,b]]){
  const grouped=groupHouseLeads([...rows,neighbor]);
  assert.equal(grouped.pins.length,2);
  assert.equal(grouped.byLead.get('a')![0].id,'c');
  assert.equal(grouped.byLead.get('c')!.length,3);
 }
});
test('duplicate parcel rows paint one house; a worked house never also gets an unworked dot',()=>{
 const h={id:'home-a',address:'814 Example Rd',addressNorm:'814 EXAMPLE RD',municipality:'Rochester',state:'NY',lat:43.1566,lng:-77.6088} as Homeowner;
 const homes=[h,{...h,id:'home-b',address:'814 Example Road'}, {...h,id:'neighbor',address:'816 Example Rd',addressNorm:'816 EXAMPLE RD',lng:-77.6089}];
 assert.equal(mergeHomeowners(homes,buildHouseIndex([])).gray.length,2);
 const merged=mergeHomeowners(homes,buildHouseIndex([lead('older'),lead('latest',14)]));
 assert.equal(merged.gray.length,1);assert.equal(merged.gray[0].id,'neighbor');
 assert.deepEqual([...merged.hiddenLeadIds],['older']);
});
test('duplicate document snapshots resolve before house grouping and never duplicate history sources',()=>{
 const group=groupHouseLeads([lead('one',14),lead('one',10),lead('two',12)]);
 assert.equal(group.pins.length,1);assert.equal(group.pins[0].id,'one');assert.equal(group.groups[0].length,2);
});

// A customer classification must not replace the most recent door result.
import {fieldPinStyle} from '../../app/utils/fieldPin';
test('a saved customer type does not override the latest knock artwork',()=>{
 for(const [status,kind] of [['not-home','away'],['not-interested','no'],['go-back','return'],['do-not-knock','stop']]){
  const style=fieldPinStyle({id:'customer-knock',status,leadType:'customer'} as Lead);
  assert.equal(style.kind,kind);
 }
});
