import { auth } from '@/app/utils/firebase';
import { apiFetch } from '@/app/utils/apiFetch';
import { isDeviceOnline } from '@/app/utils/connectivity';
export type VoiceFeedback = {id:string;uid:string;audio:Blob;note:string;createdAt:string;version:string;platform:string};
const locks = new Map<string,Promise<void>>();
function open(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{const r=indexedDB.open('raydar-voice-feedback-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function feedbackItems(uid:string):Promise<VoiceFeedback[]> {
  const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('recordings');const r=tx.objectStore('recordings').getAll();r.onsuccess=()=>resolve(r.result.filter((x:VoiceFeedback)=>x.uid===uid));r.onerror=()=>reject(r.error);});}finally{db.close();}
}
async function mutate(value:VoiceFeedback|string) {
  const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('recordings','readwrite'),store=tx.objectStore('recordings');typeof value==='string'?store.delete(value):store.put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  window.dispatchEvent(new Event('raydar-feedback-change'));
}
export async function queueFeedback(value:VoiceFeedback) {
  if(auth?.currentUser?.uid!==value.uid)throw Error('Sign in again before sending feedback.');
  if((await feedbackItems(value.uid)).length>=3)throw Error('Send your three pending recordings before adding another.');
  await mutate(value);
}
export async function removeFeedback(id:string,uid:string) {
  if((await feedbackItems(uid)).some(x=>x.id===id))await mutate(id);
}
function base64(blob:Blob):Promise<string> {return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
export function syncFeedback(uid:string) {
  if(locks.has(uid))return locks.get(uid)!;
  const task=(async()=>{
    if(!isDeviceOnline() || auth?.currentUser?.uid!==uid)return;
    for(const item of await feedbackItems(uid)){
      if(auth?.currentUser?.uid!==uid)return;
      const token=await auth.currentUser.getIdToken();
      if(auth?.currentUser?.uid!==uid)return;
      const res=await apiFetch('/api/mobile-feedback',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({...item,audio:await base64(item.audio),mime:item.audio.type})});
      if(!res.ok)throw Error(res.status===404?'Feedback is saved on this phone. The company server needs the v14.8 feedback update.':'Feedback is saved on this phone. Retry when connected.');
      const saved=await res.json();
      if(saved?.saved!==true || saved.id!==item.id)throw Error('Feedback is saved on this phone. The server did not confirm this recording.');
      await mutate(item.id);
    }
  })().finally(()=>locks.delete(uid));
  locks.set(uid,task);return task;
}
