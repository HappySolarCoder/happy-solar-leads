import test from 'node:test';
import assert from 'node:assert/strict';
import type { Lead } from '../../app/types';
import { fieldPinArtwork, fieldPinZoomTier, isSolarWarmLead } from '../../app/utils/fieldPin';
import { compassDirection, normalizeHeading, orientationReading, smoothHeading } from '../../app/utils/compass';

const lead={id:'sample',status:'assigned',address:'1 Example',name:'Sample',city:'Rochester',state:'NY',zip:'',createdAt:new Date(0)} as Lead;
test('imported solar leads are distinct from manual, ordinary and historical pins',()=>{
  assert.equal(isSolarWarmLead({...lead,solarCategory:'great'}),true);
  assert.equal(isSolarWarmLead({...lead,solarScore:72}),true);
  assert.equal(isSolarWarmLead({...lead,tags:['solar-data']}),true);
  assert.equal(isSolarWarmLead({...lead,source:'manually-added',solarCategory:'great'}),false);
  assert.equal(isSolarWarmLead({...lead,source:'manually-added',tags:['solar-data']}),true); // Imported upgrade.
  assert.equal(isSolarWarmLead({...lead,leadType:'customer',tags:['solar-data']}),false);
  assert.equal(isSolarWarmLead({...lead,historicalTerritoryPin:true,tags:['solar-data']}),false);
  assert.equal(isSolarWarmLead({...lead,solarScore:NaN}),false);
  assert.equal(isSolarWarmLead(lead),false);
});
test('warm badge coexists with disposition, solar score, outcome and selection',()=>{
  const warm={...lead,status:'appointment',solarCategory:'great' as const,appointmentOutcome:'Sold'};
  const marked=fieldPinArtwork(warm,undefined,18,true);
  assert.equal(marked.style.kind,'appointment');
  assert.match(marked.label,/warm lead/);
  assert.match(marked.label,/GHL Sold/);
  assert.match(marked.label,/great roof/);
  assert.match(decodeURIComponent(marked.url),/data-warm-lead="true"/);
  assert.notEqual(marked.url,fieldPinArtwork({...warm,source:'manual'},undefined,18,true).url);
  assert.equal(marked.url,fieldPinArtwork(warm,undefined,18,true).url);
  assert.ok(fieldPinArtwork(warm,undefined,18).size<fieldPinArtwork(warm,undefined,17).size);
  assert.equal(fieldPinArtwork(warm,undefined,19).size,20);
  assert.notEqual(fieldPinZoomTier(17),fieldPinZoomTier(18));
});
test('compass uses absolute north readings and correctly handles portrait/landscape',()=>{
  const event={alpha:0,beta:0,gamma:0,absolute:true};
  for(const [alpha,heading] of [[0,0],[270,90],[180,180],[90,270]]) {
    assert.ok(Math.abs(orientationReading({...event,alpha})!.heading!-heading)<.001);
  }
  assert.equal(orientationReading({...event,absolute:false}),null);
  assert.equal(orientationReading({...event,alpha:null}),null);
  assert.equal(orientationReading({...event,beta:null}),null);
  assert.equal(orientationReading({...event,beta:90})?.status,'flat');
  assert.ok(Math.abs(orientationReading(event,90)!.heading!-90)<.001);
  assert.ok(Math.abs(orientationReading(event,270)!.heading!-270)<.001);
  assert.equal(orientationReading({...event,webkitCompassHeading:42,webkitCompassAccuracy:-1})?.status,'calibrate');
  assert.equal(orientationReading({...event,absolute:false,webkitCompassHeading:42,webkitCompassAccuracy:10})?.heading,42);
});
test('heading smoothing crosses north without swinging south',()=>{
  const smoothed=smoothHeading(359,1);
  assert.ok(smoothed>350 || smoothed<10);
  assert.equal(normalizeHeading(-90),270);
  assert.equal(compassDirection(360),'N');
  assert.equal(compassDirection(45),'NE');
  assert.equal(compassDirection(225),'SW');
});
