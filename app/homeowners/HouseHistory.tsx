'use client';
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Lead } from '@/app/types';
import { auth, db } from '@/app/utils/firebase';
import { mapLeadDoc } from '@/app/utils/firestore';
import { houseHistory, latestVisit } from './houseIdentity';

const EMPTY: Lead[]=[];
const cachedHistory = new Map<string,{at:number;lead:Lead}>();
const CACHE_MS=5*60_000;
/** Fetch only the selected house's older summaries, in small on-demand batches.
 * Aggregated entries are display-only, never part of the canonical save object. */
export default function HouseHistory({lead, related=EMPTY, uid}: {lead:Lead;related?:Lead[];uid?:string}) {
  const [full,setFull]=useState<Record<string,Lead>>({}), [limit,setLimit]=useState(8), [visible,setVisible]=useState(10);
  const [loading,setLoading]=useState(false), [failed,setFailed]=useState(false), [retry,setRetry]=useState(0);
  const sources=useMemo(()=>[lead,...related.filter(l=>l.id!==lead.id)], [lead,related]);
  const summaries=sources.filter(l=>l.id!==lead.id && (l as Lead & {mobileSummary?:boolean}).mobileSummary);
  const request=JSON.stringify(summaries.slice(0,limit).map(l=>[l.id,latestVisit(l)]));
  useEffect(()=>{
    if(!uid || !db)return;
    const pending=JSON.parse(request) as [string,number][];
    if(!pending.length)return;
    let active=true;
    void Promise.resolve().then(async()=>{
      if(!active)return;
      setLoading(true);setFailed(false);
      // Four concurrent reads at most; never scan a collection to find duplicates.
      for(let i=0;i<pending.length && active;i+=4){
        const rows=await Promise.all(pending.slice(i,i+4).map(async ([id,version])=>{
          try{
            const key=`${uid}:${id}:${version}`, cached=cachedHistory.get(key);
            if(cached && Date.now()-cached.at<CACHE_MS)return cached.lead;
            const snapshot=await getDoc(doc(db!,'leads',id));
            if(!snapshot.exists()){if(active)setFailed(true);return null;}
            const loaded=mapLeadDoc(snapshot);
            if(auth?.currentUser?.uid!==uid)return null;
            cachedHistory.set(key,{at:Date.now(),lead:loaded});
            while(cachedHistory.size>96)cachedHistory.delete(cachedHistory.keys().next().value!);
            return loaded;
          }
          catch{if(active)setFailed(true);return null;}
        }));
        if(!active || auth?.currentUser?.uid!==uid)return;
        setFull(previous=>({...previous,...Object.fromEntries(rows.filter((l):l is Lead=>!!l).map(l=>[l.id,l]))}));
      }
      if(active)setLoading(false);
    });
    return()=>{active=false;};
  },[request,uid,retry]);
  const history=useMemo(()=>houseHistory(sources.map(l=>l.id===lead.id?l:full[l.id]||l)),[sources,full,lead.id]);
  if(!history.length && !loading && !failed)return null;
  return <section className="mt-6 pt-5 border-t border-[#E2E8F0]" aria-label="Disposition history">
    <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Disposition History</h3>
    {sources.length>1 && <p className="text-xs text-[#718096] mb-3">Combined visits at this home · newest first</p>}
    <ol className="space-y-3">{history.slice(0,visible).map((entry,index)=><li key={`${entry.timestamp.getTime()}:${entry.userId}:${entry.disposition}:${index}`} className="flex items-start gap-2 text-xs">
      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-[#587E98] mt-1.5" />
      <div className="flex-1"><strong className="block text-[#2D3748]">{entry.disposition}</strong>
        <span className="block text-[#718096]">{entry.userName || 'Rep not recorded'} · <time dateTime={entry.timestamp.toISOString()}>{entry.timestamp.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</time></span>
      </div>
    </li>)}</ol>
    {loading && <p role="status" className="text-xs mt-3">Loading older visits…</p>}
    {failed && <p role="status" className="text-xs mt-3">Some older visits could not load. Saved history is unchanged. <button className="rm-text-button" onClick={()=>setRetry(n=>n+1)}>Retry history</button></p>}
    {history.length>visible && <button className="rm-secondary mt-3" onClick={()=>setVisible(n=>n+10)}>Show more history</button>}
    {summaries.length>limit && !loading && <button className="rm-secondary mt-3" onClick={()=>setLimit(n=>n+8)}>Load older records</button>}
  </section>;
}
