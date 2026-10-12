import test from 'node:test';
import assert from 'node:assert/strict';
import { unreflectedKnocks } from '../../app/field/confirmedKnocks';
import type { Lead } from '../../app/types';
import type { PendingMutation } from '../../app/field/types';
const knock = {id:'event',leadId:'door',userId:'rep',kind:'knock',createdAt:'2026-10-12T04:00:00Z'} as PendingMutation;
test('acknowledged knock stays visible during snapshot lag and clears when the listener catches up',()=>{
 const older = {id:'door',dispositionedAt:new Date('2026-10-11T12:00:00Z')} as Lead;
 assert.deepEqual(unreflectedKnocks([knock],[older],'rep'),[knock]);
 assert.deepEqual(unreflectedKnocks([knock],[{...older,dispositionedAt:new Date(knock.createdAt)}],'rep'),[]);
 assert.deepEqual(unreflectedKnocks([knock],[{...older,dispositionedAt:new Date('2026-10-12T05:00:00Z')}],'rep'),[]);
});
test('newly created pins remain visible before the first snapshot, without leaking across accounts',()=>{
 assert.deepEqual(unreflectedKnocks([knock],[],'rep'),[knock]);
 assert.deepEqual(unreflectedKnocks([knock],[],'other-rep'),[]);
});
