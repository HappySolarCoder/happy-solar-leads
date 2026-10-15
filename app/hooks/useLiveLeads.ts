'use client';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { mapLeadDoc } from '@/app/utils/firestore';
import { isDeviceOnline } from '@/app/utils/connectivity';
import type { Lead, User } from '@/app/types';
import { startupEvent } from '@/app/mobile/_lib/startupDiagnostics';
import { mergeLeadSnapshots } from '@/app/homeowners/houseIdentity';

type Result = { userId:string; leads:Lead[]; error:string; cached:boolean; complete:boolean };
const cache = new Map<string,{at:number; result:Result}>();
const pending = new Map<string,Promise<Result>>();
const TTL=15*60_000;
const duringRead = new Map<string, Map<string, Lead>>();
const upsert = (leads: Lead[], lead: Lead) => mergeLeadSnapshots(leads,[lead]);
/** Apply an acknowledged write without another billed query. In-flight reads
 * cannot overwrite a write acknowledged after they started. */
export function acknowledgeMobileLead(user: Pick<User, 'id' | 'role'>, lead: Lead) {
  if (auth?.currentUser?.uid !== user.id) return;
  const key = `${user.id}:${user.role}`, saved = cache.get(key);
  const updates=duringRead.get(key), previous=updates?.get(lead.id);
  updates?.set(lead.id,upsert(previous?[previous]:[],lead)[0]);
  cache.set(key, saved ? {...saved, result: {...saved.result, leads: upsert(saved.result.leads, lead)}}
    : {at:0, result:{userId:user.id, leads:[lead], error:'', cached:true, complete:false}});
  window.dispatchEvent(new CustomEvent('raydar-lead-acknowledged', {detail: {key, lead}}));
}
function readPersonal(uid:string,role:string) {
  const key=`${uid}:${role}`,existing=pending.get(key);
  if(existing)return existing;
  const updates = new Map<string, Lead>(); duringRead.set(key, updates);
  const task=(async()=>{
    const token=await auth?.currentUser?.getIdToken();
    if(!token || auth?.currentUser?.uid!==uid)throw Error('Sign in again to load your activity.');
    const started=Date.now();startupEvent('personal-leads-start');
    const records=new Map<string,Lead>();
    const fields=role==='admin'?['recent','assignedTo','claimedBy','goBackScheduledBy']:['assignedTo','claimedBy','goBackScheduledBy'];
    for(const field of fields){
      let cursor:string|null=null,afterSeconds=0,afterNanos=0;
      do{
        if(auth?.currentUser?.uid!==uid)throw Error('Account changed.');
        const params=new URLSearchParams({mode:'personal',field,...(cursor?{after:cursor,...(field==='recent'?{afterSeconds:String(afterSeconds),afterNanos:String(afterNanos)}:{})}:{})});
        const response=await apiFetch(`/api/mobile-leads?${params}`,{headers:{Authorization:`Bearer ${token}`}});
        if(!response.ok)throw Error(response.status===404?'The company server needs the v14.8 data update. Your saved knocks are safe.':'Your activity could not refresh. Tap Retry data.');
        const data=await response.json();
        if(auth?.currentUser?.uid!==uid)throw Error('Account changed.');
        for(const lead of data.leads||[]){
          const previous=records.get(lead.id), incoming=mapLeadDoc({id:lead.id,data:()=>lead});
          records.set(lead.id,mergeLeadSnapshots(previous?[previous]:[],[incoming])[0]);
        }
        // Never present a partial result as complete totals.
        if(records.size>6000)throw Error('Your activity is too large to load safely. Contact your manager; saved knocks are safe.');
        cursor=data.nextCursor||null;afterSeconds=data.afterSeconds;afterNanos=data.afterNanos;
      }while(cursor);
    }
    for (const lead of updates.values()) records.set(lead.id,upsert(records.has(lead.id)?[records.get(lead.id)!]:[],lead)[0]);
    const result={userId:uid,leads:[...records.values()],error:'',cached:false,complete:true};
    cache.set(key,{at:Date.now(),result});while(cache.size>2)cache.delete(cache.keys().next().value!);
    startupEvent('personal-leads-ready',started);return result;
  })().finally(()=>{pending.delete(key);duringRead.delete(key);});
  pending.set(key,task);return task;
}
/** One shared personal refresh per account. Navigation never starts parallel
 * scans or puts company-wide lead snapshots in the phone's Firestore cache. */
export function useLiveLeads(user:User|null,retryAttempt=0){
  const uid=user?.id,role=user?.role||'',key=`${uid}:${role}`;
  const [attempt,setAttempt]=useState(0),[state,setState]=useState<{key:string;result:Result}|null>(null);
  const retry=useCallback(()=>setAttempt(v=>v+1),[]);
  useEffect(()=>{
    if(!uid)return;
    let active=true;
    const saved=cache.get(key),publish=(result:Result)=>{if(active && auth?.currentUser?.uid===uid)setState({key,result});};
    if(saved)publish({...saved.result,cached:true});
    if(saved && Date.now()-saved.at<TTL && !attempt && !retryAttempt)return;
    if(!isDeviceOnline()){
      publish(saved?.result||{userId:uid,leads:[],error:'Offline. Your saved knocks will sync when you reconnect.',cached:true,complete:false});return;
    }
    void readPersonal(uid,role).then(publish).catch(e=>publish({userId:uid,leads:cache.get(key)?.result.leads||[],error:e.message,cached:cache.has(key),complete:false}));
    return()=>{active=false;};
  },[uid,role,key,retryAttempt,attempt]);
  useEffect(() => {
    const acknowledged = (event: Event) => {
      const detail = (event as CustomEvent<{key:string;lead:Lead}>).detail;
      if (detail.key !== key || auth?.currentUser?.uid !== uid) return;
      setState(previous => ({key, result: {...(previous?.key === key ? previous.result : {userId:uid!,error:'',cached:true,complete:false,leads:[]}),
        leads: upsert(previous?.key === key ? previous.result.leads : [], detail.lead)}}));
    };
    window.addEventListener('raydar-lead-acknowledged', acknowledged);
    return () => window.removeEventListener('raydar-lead-acknowledged', acknowledged);
  }, [key, uid]);
  useEffect(()=>{
    const reconnect=()=>{if(isDeviceOnline())retry();};
    const visible=()=>{if(document.visibilityState==='visible' && Date.now()-(cache.get(key)?.at||0)>TTL)reconnect();};
    window.addEventListener('online',reconnect);window.addEventListener('raydar-network-change',visible);document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('online',reconnect);window.removeEventListener('raydar-network-change',visible);document.removeEventListener('visibilitychange',visible);};
  },[key,retry]);
  return state?.key===key?state.result:null;
}
