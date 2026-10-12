'use client';
import { useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { mapLeadDoc } from '@/app/utils/firestore';
import { isDeviceOnline } from '@/app/utils/connectivity';
import { inPinScope, scopedViews, type PinScope } from '@/app/mobile/_lib/pinScope';
import type { Lead, User } from '@/app/types';
import type { View } from '@/app/homeowners/model';
type Value = { leads:Lead[]; loading:boolean; error:string; partial:boolean };
const EMPTY:Value={leads:[],loading:false,error:'',partial:false};
const cache = new Map<string,{at:number;value:Value}>();
export function useViewportLeads(user:User|null, view:View|null, polygons:PinScope, ready:boolean) {
  const uid=user?.id, role=user?.role;
  const scope=JSON.stringify([uid,role,polygons]);
  const [state,setState]=useState<{scope:string;value:Value}>({scope:'',value:EMPTY});
  const [attempt,setAttempt]=useState(0);
  const key=view ? [view.south,view.north,view.west,view.east,view.zoom].map(n=>n.toFixed(5)).join(':') : '';
  useEffect(()=>{
    if(!uid || !view || !ready || view.zoom<15 || !scopedViews(view,polygons).length){setState({scope,value:EMPTY});return;}
    let active=true;
    const cacheKey=`${scope}:${key}`,saved=cache.get(cacheKey);
    if(saved){setState({scope,value:saved.value});if(Date.now()-saved.at<300_000 && !attempt)return;}
    const publish=(value:Value)=>{if(active && auth?.currentUser?.uid===uid)setState({scope,value});};
    const timer=setTimeout(()=>{void (async()=>{
      if(!isDeviceOnline()){if(!saved)publish({...EMPTY,error:'Offline. Only saved pins are shown.'});return;}
      const token=await auth?.currentUser?.getIdToken();if(!token || auth?.currentUser?.uid!==uid)return;
      publish({...(saved?.value||EMPTY),loading:true});
      const found=new Map<string,Lead>();let cursor:{id:string;lat:number}|null=null;
      for(let page=0;page<2 && active;page++){
        const params=new URLSearchParams({mode:'map',south:String(view.south),north:String(view.north),west:String(view.west),east:String(view.east),zoom:String(view.zoom)});
        if(cursor){params.set('after',cursor.id);params.set('afterLat',String(cursor.lat));}
        const res=await apiFetch(`/api/mobile-leads?${params}`,{headers:{Authorization:`Bearer ${token}`}});
        if(!res.ok)throw Error(res.status===404 ? 'The company server needs the v14.8 map update.' : 'Pins could not load. Zoom closer or tap Retry pins.');
        const data=await res.json();if(!active || auth?.currentUser?.uid!==uid)return;
        for(const l of data.leads||[])if(inPinScope(l.lat,l.lng,polygons))found.set(l.id,mapLeadDoc({id:l.id,data:()=>l}));
        cursor=data.nextCursor;
        publish({leads:[...found.values()],loading:!!cursor && page===0,error:'',partial:!!cursor});
        if(!cursor)break;
      }
      const value={leads:[...found.values()],loading:false,error:'',partial:!!cursor};
      cache.delete(cacheKey);cache.set(cacheKey,{at:Date.now(),value});while(cache.size>6)cache.delete(cache.keys().next().value!);
      publish(value);
    })().catch(e=>publish({...EMPTY,leads:saved?.value.leads||[],error:e.message}));},250);
    return()=>{active=false;clearTimeout(timer);};
  // key contains the viewport primitives. Stable scope prevents GPS-only renders restarting reads.
  },[uid,role,key,scope,ready,attempt]);
  useEffect(()=>{const online=()=>setAttempt(v=>v+1);window.addEventListener('online',online);return()=>window.removeEventListener('online',online);},[]);
  return {...(state.scope===scope ? state.value:EMPTY),retry:()=>setAttempt(v=>v+1)};
}
