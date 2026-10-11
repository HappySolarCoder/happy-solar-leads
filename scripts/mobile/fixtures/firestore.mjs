import {records,stamp,FixtureTimestamp} from './data.mjs';
export const getFirestore=()=>({audit:true});
export const initializeFirestore=getFirestore;
export const collection=(db,...parts)=>({kind:'collection',path:parts.join('/')});
export const doc=(db,...parts)=>({kind:'doc',path:[db.path,...parts].filter(Boolean).join('/')});
export const where=(field,op,value)=>({kind:'where',field,op,value});
export const orderBy=(field,direction='asc')=>({kind:'order',field,direction});
export const startAt=(value)=>({kind:'start',value});
export const endAt=(value)=>({kind:'end',value});
export const limit=(value)=>({kind:'limit',value});
export const query=(ref,...constraints)=>({...ref,constraints});
const testState=()=>typeof window==='undefined'?undefined:window.__raydarWriteTest;
const listeners=new Set();
function revive(v){if(Array.isArray(v))return v.map(revive);if(v&&typeof v==='object'){if(typeof v.seconds==='number'&&typeof v.nanoseconds==='number')return stamp(new Date(v.seconds*1000+v.nanoseconds/1000000));return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,revive(x)]));}return v;}
if(testState())Object.assign(testState(),revive(testState()));
const rows=name=>{const base=records(name);const saved=name==='leads'?Object.values(testState()?.leads||{}):[];return [...base.filter(d=>!saved.some(s=>s.id===d.id)),...saved];};
const value=(data,path)=>path.split('.').reduce((v,k)=>v?.[k],data);
function snapshot(item){return {id:item?.id||'missing',exists:()=>!!item,data:()=>item};}
export async function getDoc(ref){const parts=ref.path.split('/');return snapshot(rows(parts[0]).find(d=>d.id===parts[1]));}
export async function getDocs(ref){let data=rows(ref.path.split('/')[0]);if(testState())testState().reads.push(ref.path);for(const c of ref.constraints||[]){if(c.kind==='where')data=data.filter(d=>{const a=value(d,c.field),b=c.value;return c.op==='=='?a===b:c.op==='in'?b.includes(a):c.op==='array-contains'?a?.includes(b):c.op==='!='?a!==b:true;});if(c.kind==='start')data=data.filter(d=>d.geohash>=c.value);if(c.kind==='end')data=data.filter(d=>d.geohash<=c.value);if(c.kind==='limit')data=data.slice(0,c.value);}const docs=data.map(snapshot);return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false},forEach:cb=>docs.forEach(cb),docChanges:()=>docs.map(doc=>({type:'added',doc}))};}
export const getDocsFromServer=getDocs;
export function onSnapshot(ref,options,next){const cb=typeof options==='function'?options:next;let alive=true,previous=new Map();const emit=()=>void getDocs(ref).then(s=>{if(!alive)return;const now=new Map(s.docs.map(d=>[d.id,d]));const changes=[...s.docs.map(doc=>({type:previous.has(doc.id)?'modified':'added',doc})),...[...previous].filter(([id])=>!now.has(id)).map(([,doc])=>({type:'removed',doc}))];previous=now;cb({...s,docChanges:()=>changes});});listeners.add(emit);emit();return()=>{alive=false;listeners.delete(emit);};}
export const Timestamp=FixtureTimestamp;
const noWrite=async()=>{throw Error('Database writes are disabled in the fictional page audit.');};
async function testWrite(kind,ref,data){const s=testState();if(!s)return noWrite();if(s.fail)throw Error('Fictional save failed');if(!ref.path.startsWith('leads/'))throw Error('Unexpected fixture collection write');const id=ref.path.split('/')[1];if(kind==='update'&&!s.leads[id]&&!records('leads').some(l=>l.id===id))throw Error('Missing lead');s.writes.push({kind,path:ref.path,data});s.leads[id]={...(kind==='update'?(s.leads[id]||records('leads').find(l=>l.id===id)):{}),...data,id};for(const [k,v]of Object.entries(s.leads[id]))if(v?.auditDelete)delete s.leads[id][k];listeners.forEach(emit=>emit());localStorage.setItem('raydar-fixture-backend',JSON.stringify(s));}
export const updateDoc=(ref,data)=>testWrite('update',ref,data),setDoc=(ref,data)=>testWrite('create',ref,data),addDoc=noWrite,deleteDoc=noWrite;
export const deleteField=()=>({auditDelete:true});export const arrayUnion=(...values)=>values;
export const writeBatch=()=>({set:noWrite,update:noWrite,delete:noWrite,commit:noWrite});

// Isolated v12.6 direct-write test adapter. Production exports never alias this module.
export async function runTransaction(db, action) {
 const s=testState(); if(!s) return noWrite();
 const writes=[];
 const result=await action({
  get:async ref=>{
   s.reads.push(ref.path);
   const snapshot=await getDoc(ref);
   if(!snapshot.exists()) throw Object.assign(Error('Fixture rules deny reading a missing lead'),{code:'permission-denied'});
   return snapshot;
  },
  update:(ref,data)=>writes.push(['update',ref,data]),
  set:(ref,data)=>writes.push(['create',ref,data]),
 });
 for(const args of writes)await testWrite(...args);
 return result;
}
function restDecode(v){
 if('timestampValue'in v)return stamp(new Date(v.timestampValue));
 if('stringValue'in v)return v.stringValue;
 if('integerValue'in v)return Number(v.integerValue);
 if('doubleValue'in v)return v.doubleValue;
 if('booleanValue'in v)return v.booleanValue;
 if('nullValue'in v)return null;
 if('arrayValue'in v)return (v.arrayValue.values||[]).map(restDecode);
 if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,restDecode(x)]));
 throw Error('Unknown fixture REST type');
}
if(typeof window!=='undefined')window.__raydarFixtureRestCommit=async payload=>{
 const w=payload.writes?.[0];
 if(payload.writes.length!==1||w.currentDocument?.exists!==false)throw Error('Expected one create-only write');
 const path=w.update.name.split('/documents/')[1];
 if(!path.startsWith('leads/'))throw Error('Unexpected collection');
 const id=path.split('/')[1];
 if(rows('leads').some(l=>l.id===id))return {status:409,json:{error:{status:'ALREADY_EXISTS'}}};
 const data=Object.fromEntries(Object.entries(w.update.fields).map(([k,v])=>[k,restDecode(v)]));
 try{await testWrite('create',{path},data);return {status:200,json:{writeResults:[{}]}};}
 catch(e){return {status:503,json:{error:{status:'UNAVAILABLE'}}};}
};
