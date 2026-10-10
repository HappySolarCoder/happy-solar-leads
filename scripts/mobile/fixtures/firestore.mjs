import {records,stamp} from './data.mjs';
export const getFirestore=()=>({audit:true});
export const collection=(db,...parts)=>({kind:'collection',path:parts.join('/')});
export const doc=(db,...parts)=>({kind:'doc',path:[db.path,...parts].filter(Boolean).join('/')});
export const where=(field,op,value)=>({kind:'where',field,op,value});
export const orderBy=(field,direction='asc')=>({kind:'order',field,direction});
export const startAt=(value)=>({kind:'start',value});
export const endAt=(value)=>({kind:'end',value});
export const limit=(value)=>({kind:'limit',value});
export const query=(ref,...constraints)=>({...ref,constraints});
const value=(data,path)=>path.split('.').reduce((v,k)=>v?.[k],data);
function snapshot(item){return {id:item?.id||'missing',exists:()=>!!item,data:()=>item};}
export async function getDoc(ref){const parts=ref.path.split('/');return snapshot(records(parts[0]).find(d=>d.id===parts[1]));}
export async function getDocs(ref){let data=records(ref.path.split('/')[0]);for(const c of ref.constraints||[]){if(c.kind==='where')data=data.filter(d=>{const a=value(d,c.field),b=c.value;return c.op==='=='?a===b:c.op==='in'?b.includes(a):c.op==='array-contains'?a?.includes(b):c.op==='!='?a!==b:true;});if(c.kind==='limit')data=data.slice(0,c.value);}const docs=data.map(snapshot);return {docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false},forEach:cb=>docs.forEach(cb),docChanges:()=>docs.map(doc=>({type:'added',doc}))};}
export const getDocsFromServer=getDocs;
export function onSnapshot(ref,options,next){const cb=typeof options==='function'?options:next;let alive=true;void getDocs(ref).then(s=>{if(alive)cb(s);});return()=>{alive=false;};}
export const Timestamp={fromDate:stamp,now:()=>stamp()};
const noWrite=async()=>{throw Error('Database writes are disabled in the fictional page audit.');};
export const updateDoc=noWrite,setDoc=noWrite,addDoc=noWrite,deleteDoc=noWrite;
export const deleteField=()=>({auditDelete:true});export const arrayUnion=(...values)=>values;
export const writeBatch=()=>({set:noWrite,update:noWrite,delete:noWrite,commit:noWrite});
