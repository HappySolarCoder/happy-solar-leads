'use client';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Mic, Square, MessageSquare, X } from 'lucide-react';
import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { feedbackItems, queueFeedback, removeFeedback, syncFeedback, type VoiceFeedback as Recording } from '../_lib/feedbackQueue';
import { MOBILE_BUILD_LABEL } from '../_lib/startupDiagnostics';
import MobileDialog from './MobileDialog';
export function FeedbackSync({uid}:{uid:string}) {
  useEffect(()=>{const send=()=>{if(document.visibilityState!=='hidden')void syncFeedback(uid).catch(()=>{});};send();window.addEventListener('online',send);document.addEventListener('visibilitychange',send);return()=>{window.removeEventListener('online',send);document.removeEventListener('visibilitychange',send);};},[uid]);
  return null;
}
type Sent={id:string;name?:string;note?:string;createdAt?:string;url:string;version?:string;platform?:string};
export default function VoiceFeedback({uid,admin}:{uid:string;admin:boolean}) {
  const [open,setOpen]=useState(false),[recording,setRecording]=useState(false),[seconds,setSeconds]=useState(0),[blob,setBlob]=useState<Blob|null>(null),[url,setUrl]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[queued,setQueued]=useState<Recording[]>([]),[sent,setSent]=useState<Sent[]>([]),[cursor,setCursor]=useState<string|null>(null),[review,setReview]=useState(false);
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),alive=useRef(true),generation=useRef(0);
  const stop=()=>{clearInterval(timer.current); if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;};
  useEffect(()=>{alive.current=true;const refresh=()=>{void feedbackItems(uid).then(items=>{if(alive.current){setQueued(items);if(!items.length)setError(current=>current.startsWith('Feedback is saved')?'Feedback sent. Thank you.':current);}}).catch(()=>{});};refresh();window.addEventListener('raydar-feedback-change',refresh);const hidden=()=>{if(document.visibilityState==='hidden')stop();};document.addEventListener('visibilitychange',hidden);return()=>{alive.current=false;stop();window.removeEventListener('raydar-feedback-change',refresh);document.removeEventListener('visibilitychange',hidden);};},[uid]);
  useEffect(()=>{if(!blob){setUrl('');return;}const u=URL.createObjectURL(blob);setUrl(u);return()=>URL.revokeObjectURL(u);},[blob]);
  async function start(){
    setError('');setBusy(true);
    const run=++generation.current;
    try{
      if(!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined')throw Error('Recording is unavailable on this device. Check microphone access and try again.');
      const input=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!alive.current || generation.current!==run || document.visibilityState==='hidden'){input.getTracks().forEach(t=>t.stop());return;}
      stream.current=input;
      const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(type=>MediaRecorder.isTypeSupported(type));
      const r=new MediaRecorder(input,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});recorder.current=r;
      const chunks:Blob[]=[];let bytes=0;
      r.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>1_800_000)stop();}};
      r.onstop=()=>{clearInterval(timer.current);input.getTracks().forEach(t=>t.stop());if(alive.current){setBlob(new Blob(chunks,{type:r.mimeType}));setRecording(false);}};
      r.onerror=()=>{stop();if(alive.current)setError('Recording stopped unexpectedly. Review the captured audio before sending.');};
      setBlob(null);setSeconds(0);setRecording(true);r.start(1000);let elapsed=0;
      timer.current=setInterval(()=>{if(alive.current)setSeconds(++elapsed);if(elapsed>=120)stop();},1000);
    }catch(e){if(alive.current)setError((e as Error).name==='NotAllowedError'?'Enable microphone access in your phone Settings and try again.':(e as Error).message);}
    finally{if(alive.current)setBusy(false);}
  }
  async function send(){
    if(!blob)return;setBusy(true);setError('');
    try {await queueFeedback({id:crypto.randomUUID(),uid,audio:blob,note,createdAt:new Date().toISOString(),version:MOBILE_BUILD_LABEL,platform:Capacitor.getPlatform()});setBlob(null);setNote('');await syncFeedback(uid);setError((await feedbackItems(uid)).length?'Feedback is saved on this phone. It will send when you reconnect.':'Feedback sent. Thank you.');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function loadSent(next?:string){
    setBusy(true);setError('');try{const token=await auth?.currentUser?.getIdToken();const p=new URLSearchParams({all:admin?'1':'0',...(next?{cursor:next}:{})});const res=await apiFetch(`/api/mobile-feedback?${p}`,{headers:{Authorization:`Bearer ${token}`}});if(!res.ok)throw Error('Saved feedback could not load. Check the server update and try again.');const data=await res.json();setSent(v=>next?[...v,...data.items]:data.items);setCursor(data.cursor);setReview(true);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <><button className="rm-menu-row" onClick={()=>setOpen(true)}><span className="rm-metric-icon sage"><MessageSquare size={21}/></span><span><strong>Send voice feedback</strong><small>{queued.length?`${queued.length} recording${queued.length===1?'':'s'} waiting to send`:'Tell us what worked or needs fixing'}</small></span></button>
    {open && <MobileDialog title="Help improve Raydar" onClose={()=>{generation.current++;stop();setOpen(false);}}><div className="rm-feedback">
      <div className="rm-panel-heading"><h2>Voice feedback</h2><button aria-label="Close voice feedback" onClick={()=>{generation.current++;stop();setOpen(false);}}><X size={22}/></button></div>
      <p>Record up to two minutes. Your audio, message, app version, and name go to your Raydar admins. Recording stops when you leave this screen.</p>
      <button className="rm-primary" disabled={busy} onClick={recording?stop:start}>{recording?<><Square size={18}/> Stop · {seconds}s</>:<><Mic size={18}/> Record feedback</>}</button>
      {url && <audio controls src={url} aria-label="Review your feedback recording"/>}
      <label htmlFor="feedback-note">What were you doing?</label><textarea id="feedback-note" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional: screen, issue, or suggestion"/>
      {blob && <div className="rm-feedback-actions"><button className="rm-primary" disabled={busy||recording} onClick={()=>void send()}>Send recording</button><button className="rm-secondary" disabled={busy} onClick={()=>setBlob(null)}>Discard</button></div>}
      {error && <p role="status">{error}</p>}
      {!!queued.length && <section><h3>{queued.length} unsent recording{queued.length===1?'':'s'}</h3><p>Saved on this phone. We retry when you reconnect or return to Raydar.</p><button className="rm-secondary" onClick={()=>void syncFeedback(uid).catch(e=>setError(e.message))}>Retry sending</button>{queued.map(item=><div key={item.id}><span>{new Date(item.createdAt).toLocaleString()}</span><button className="rm-secondary" onClick={()=>void removeFeedback(item.id,uid)}>Discard recording</button></div>)}</section>}
      <button className="rm-secondary" disabled={busy} onClick={()=>void loadSent()}>{admin?'Review team feedback':'My sent feedback'}</button>
      {review && <section>{!sent.length && <p>No sent feedback yet.</p>}{sent.map(item=><article key={item.id}><strong>{item.name}</strong><p>{item.note}</p><small>{item.createdAt && new Date(item.createdAt).toLocaleString()} · {item.version} · {item.platform}</small><audio controls preload="none" src={item.url}/><a href={item.url} download>Download recording</a></article>)}{cursor && <button className="rm-secondary" disabled={busy} onClick={()=>void loadSent(cursor)}>Load more</button>}</section>}
    </div></MobileDialog>}
  </>;
}
