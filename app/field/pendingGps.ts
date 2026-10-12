import type { Lead } from '@/app/types';
import type { PendingMutation } from './types';
import { getLocation, type LocationPosition } from '@/app/utils/geolocation';
import { distanceBetween } from 'geofire-common';
import { PROXIMITY_MAX_DISTANCE_METERS } from '@/app/utils/proximityEnforcement';
const captures = new Map<string, Promise<void>>();
export function verifiedKnockGps(m: PendingMutation, position: LocationPosition, now = Date.now()): Partial<Lead> {
  const gps = m.direct?.gps;
  if (!gps || now > gps.deadline || !Number.isFinite(position.timestamp) || position.timestamp < new Date(m.createdAt).getTime() - 5000 || position.timestamp > gps.deadline)
    throw Error('The GPS capture window expired. Review this unsynced knock; discard it and record a new knock at the door.');
  const {latitude:lat, longitude:lng, accuracy} = position.coords;
  if (![lat,lng,accuracy].every(Number.isFinite) || Math.abs(lat)>90 || Math.abs(lng)>180 || accuracy<0) throw Error('GPS returned an invalid location.');
  const distance = gps.lat != null && gps.lng != null ? distanceBetween([lat,lng],[gps.lat,gps.lng])*1000 : undefined;
  if (gps.required && (distance === undefined || distance > PROXIMITY_MAX_DISTANCE_METERS))
    throw Error('Location could not verify this knock within 164 feet of the home. Review the unsynced knock before recording it again at the door.');
  return {knockGpsLat:lat,knockGpsLng:lng,knockGpsAccuracy:accuracy,knockGpsTimestamp:new Date(position.timestamp),...(distance === undefined ? {} : {knockDistanceFromAddress:distance})};
}
/** Persist first, capture immediately. Never obtain a later location for an old knock.
 * Concurrent retries share a capture; removed drafts cannot be resurrected. */
export function resolveDraftGps(m: PendingMutation, deps: {
  read:()=>Promise<PendingMutation[]>; put:(m:PendingMutation)=>Promise<unknown>; active:()=>boolean;
  locate?:()=>Promise<LocationPosition>;
}): Promise<void> {
  if (!m.direct?.gps || m.blocked || !deps.active()) return Promise.resolve();
  const running=captures.get(m.id); if(running)return running;
  const task=(async()=>{
    let patch:Partial<Lead>|undefined, error=''; let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const left=m.direct!.gps!.deadline-Date.now();
      if(left<=0)throw Error('GPS capture expired. Review this unsynced knock; discard it and record a new knock at the door.');
      const position=await Promise.race([
        (deps.locate || (()=>getLocation({enableHighAccuracy:true,timeout:Math.min(10000,left),maximumAge:0})))(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('GPS could not verify this knock. It is saved but unsynced. Review it before recording a new knock at the door.')),left);}),
      ]);
      patch=verifiedKnockGps(m,position);
    } catch(e) {error=(e as Error).message || 'GPS verification failed. Review the unsynced knock.';}
    finally {if(timer)clearTimeout(timer);}
    if(!deps.active())return;
    const current=(await deps.read()).find(d=>d.id===m.id);
    if(!current?.direct?.gps || !deps.active())return;
    if(error)await deps.put({...current,blocked:true,error});
    else {const {gps,...direct}=current.direct;await deps.put({...current,blocked:false,error:undefined,direct:{...direct,patch:{...direct.patch,...patch}}});}
  })();
  captures.set(m.id,task);void task.finally(()=>{if(captures.get(m.id)===task)captures.delete(m.id);}).catch(()=>{});
  return task;
}
