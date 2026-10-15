'use client';
import { useEffect, useRef, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { mapLeadDoc } from '@/app/utils/firestore';
import { isDeviceOnline } from '@/app/utils/connectivity';
import { inPinScope, scopedViews, type PinScope } from '@/app/mobile/_lib/pinScope';
import { mergeLeadSnapshots } from '@/app/homeowners/houseIdentity';
import { inView, type View } from '@/app/homeowners/model';
import type { Lead, User } from '@/app/types';

type Value = { leads:Lead[]; loading:boolean; error:string; partial:boolean };
type Cursor = {id:string;lat:number} | null;
type Saved = {at:number;value:Value;cursor:Cursor;fetched:Lead[]};
const EMPTY:Value={leads:[],loading:false,error:'',partial:false};
const cache = new Map<string,Saved>();
const MAX_RETAINED = 6000;
export function useViewportLeads(user:User|null, view:View|null, polygons:PinScope, ready:boolean) {
  const uid=user?.id, role=user?.role;
  const scope=JSON.stringify([uid,role,polygons]);
  const [state,setState]=useState<{scope:string;value:Value}>({scope:'',value:EMPTY});
  const current = useRef({scope:'',value:EMPTY});
  const [attempt,setAttempt]=useState({id:0,key:'',more:false});
  const key=view ? [view.south,view.north,view.west,view.east,view.zoom].map(n=>n.toFixed(5)).join(':') : '';
  useEffect(()=>{
    let active=true;
    const publish=(value:Value)=>{
      if(active && auth?.currentUser?.uid===uid){current.current={scope,value};setState({scope,value});}
    };
    if(current.current.scope!==scope)current.current={scope,value:EMPTY};
    if(!uid || !view || !ready || !scopedViews(view,polygons).length){publish(EMPTY);return;}
    // Zooming out must not erase worked pins already loaded for this account.
    if(view.zoom<15){publish({...current.current.value,loading:false,error:'',partial:false});return;}
    const cacheKey=`${scope}:${key}`, saved=cache.get(cacheKey);
    const refresh=attempt.key===cacheKey;
    const initial=mergeLeadSnapshots(saved?.value.leads||[],current.current.value.leads)
      .filter(l=>inPinScope(l.lat,l.lng,polygons)).slice(-MAX_RETAINED);
    publish({leads:initial,loading:false,error:'',partial:saved?.value.partial||false});
    if(saved && Date.now()-saved.at<300_000 && !refresh && !saved.value.error)return;
    let cursor:Cursor=refresh && attempt.more ? saved?.cursor||null : null;
    let found:Lead[]=cursor ? saved!.fetched : [];
    const remember=(value:Value)=>{
      cache.delete(cacheKey);cache.set(cacheKey,{at:Date.now(),value:{...value,loading:false},cursor,fetched:found});
      while(cache.size>6)cache.delete(cache.keys().next().value!);
    };
    const timer=setTimeout(()=>{void (async()=>{
      if(!isDeviceOnline()){publish({...current.current.value,loading:false,error:'Offline. Only saved pins are shown.'});return;}
      const token=await auth?.currentUser?.getIdToken();if(!active || !token || auth?.currentUser?.uid!==uid)return;
      publish({...current.current.value,loading:true,error:''});
      // Keep the existing automatic budget: two pages, at most 1,000 scanned
      // records. Explicit Load more resumes, instead of rereading page one.
      for(let page=0;page<2 && active;page++){
        const params=new URLSearchParams({mode:'map',south:String(view.south),north:String(view.north),west:String(view.west),east:String(view.east),zoom:String(view.zoom)});
        if(cursor){params.set('after',cursor.id);params.set('afterLat',String(cursor.lat));}
        const res=await apiFetch(`/api/mobile-leads?${params}`,{headers:{Authorization:`Bearer ${token}`}});
        if(!active || auth?.currentUser?.uid!==uid)return;
        if(res.status===401 || res.status===403){
          for(const cachedKey of cache.keys())if(cachedKey.startsWith(`${scope}:`))cache.delete(cachedKey);
          publish({...EMPTY,error:'Sign in again or check your territory access.'});return;
        }
        if(!res.ok)throw Error(res.status===404 ? 'The company server needs the v14.8 map update.' : 'Pins could not refresh. Saved pins remain visible.');
        const data=await res.json();if(!active || auth?.currentUser?.uid!==uid)return;
        const incoming:Lead[]=(data.leads||[]).filter((l:Lead)=>inPinScope(l.lat,l.lng,polygons)).map((l:Lead)=>mapLeadDoc({id:l.id,data:()=>l}));
        found=mergeLeadSnapshots(found,incoming);
        cursor=data.nextCursor||null;
        const known=current.current.value.leads;
        // Only a complete successful view can remove missing/deleted records.
        // A partial page or failed refresh is never evidence of deletion.
        const foundIds=new Set(found.map(l=>l.id));
        const retained=cursor ? known : known.filter(l=>l.lat==null || l.lng==null || !inView({lat:l.lat,lng:l.lng},view) || foundIds.has(l.id));
        const leads=mergeLeadSnapshots(retained,found).slice(-MAX_RETAINED);
        const value={leads,loading:!!cursor && page===0,error:'',partial:!!cursor};
        remember(value);publish(value);
        if(!cursor)break;
        if(found.length>=MAX_RETAINED){publish({...value,loading:false,error:'Zoom closer to load more pins in this dense area.'});return;}
      }
      publish({...current.current.value,loading:false});
    })().catch(e=>publish({...current.current.value,loading:false,error:e.message}));},250);
    return()=>{active=false;clearTimeout(timer);};
  // The key contains viewport primitives; GPS-only renders never restart reads.
  },[uid,role,key,scope,ready,attempt]);
  const retry=(more=false)=>setAttempt(v=>({id:v.id+1,key:`${scope}:${key}`,more}));
  useEffect(()=>{
    const online=()=>setAttempt(v=>({id:v.id+1,key:`${scope}:${key}`,more:false}));
    window.addEventListener('online',online);return()=>window.removeEventListener('online',online);
  },[scope,key]);
  return {...(ready && state.scope===scope ? state.value:EMPTY),retry:()=>retry(),loadMore:()=>retry(true)};
}
