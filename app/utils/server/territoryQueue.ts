import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { getAdminApp, adminAuth, adminDb } from '../firebase-admin';
import { territoryV2, validTerritoryId } from './territoryManagementV2';
import { mayManageTerritories, type TerritoryMember } from '../territoryManager';
const workerUrl='https://happy-solar-leads.vercel.app/api/territory-assignment-worker';
export function territoryQueueReady() {
  return /^projects\/gen-lang-client-0395385938\/locations\/[a-z0-9-]+\/queues\/[a-z0-9-]+$/.test(process.env.TERRITORY_TASK_QUEUE || '') && (process.env.TERRITORY_TASK_SECRET || '').length>=32;
}
export function authorizedTerritoryWorker(value:string|null) {
  const expected=process.env.TERRITORY_TASK_SECRET || '';
  return expected.length>=32 && !!value && Buffer.byteLength(value)===Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(value),Buffer.from(expected));
}
/** The HTTP acknowledgement means Cloud Tasks owns the retry, not the phone. */
export async function enqueueTerritoryAssignment(id:string, operationId:string, cursor:unknown, retry=false) {
  if(!territoryQueueReady())throw Error('Background assignment service is not configured.');
  const queue=process.env.TERRITORY_TASK_QUEUE!;
  const credential=getAdminApp().options.credential;
  if(!credential)throw Error('Background assignment credentials are unavailable.');
  let timer:ReturnType<typeof setTimeout>|undefined;
  const token=await Promise.race([credential.getAccessToken(), new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(Error('Assignment queue authentication timed out. Retry background assignment.')),2000);
  })]).finally(()=>{if(timer)clearTimeout(timer);});
  const key=createHash('sha256').update(JSON.stringify([id,operationId,cursor,retry?randomUUID():''])).digest('hex');
  const response=await fetch(`https://cloudtasks.googleapis.com/v2/${queue}/tasks`,{
    method:'POST',signal:AbortSignal.timeout(6000),headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({task:{name:`${queue}/tasks/${key}`,dispatchDeadline:'120s',httpRequest:{httpMethod:'POST',url:workerUrl,
      headers:{'Content-Type':'application/json','X-Raydar-Task-Secret':process.env.TERRITORY_TASK_SECRET!},
      body:Buffer.from(JSON.stringify({id,operationId})).toString('base64')}}}),
  });
  if(!response.ok && response.status!==409)throw Error(`Assignment queue temporarily unavailable (${response.status}). Use Retry background assignment.`);
}
export async function runTerritoryAssignment(body:{id:string;operationId:string}, deps={db:adminDb,auth:adminAuth,enqueue:enqueueTerritoryAssignment}) {
  if(!validTerritoryId(body.id)||!validTerritoryId(body.operationId))throw Object.assign(Error('Invalid assignment.'),{status:400});
  const db=deps.db(), ref=db.collection('territories').doc(body.id);
  const started=Date.now();
  // 200 pins per transaction, up to 10 pages per task. No collection listeners.
  for(let page=0;page<10 && Date.now()-started<35000;page++) {
    const data=(await ref.get()).data(), op=data?.assignment;
    if(!data || data.archived || !op || op.id!==body.operationId || op.done)return;
    const account=await deps.auth().getUser(op.actorId);
    const actorDoc=await db.collection('users').doc(op.actorId).get();
    const actor={...actorDoc.data(),id:actorDoc.id} as TerritoryMember;
    if(account.disabled || !mayManageTerritories(actor))throw Object.assign(Error('Assignment manager permissions changed.'),{status:403});
    await territoryV2(db,actor,{action:'continue-assignment',...body});
  }
  // Read the committed cursor. A task retried after a lost acknowledgement safely
  // resumes there and ensures the next task exists before this one is acknowledged.
  const next=(await ref.get()).data();
  if(next && !next.archived && next.assignment?.id===body.operationId && !next.assignment.done)
    await deps.enqueue(body.id,body.operationId,next.assignment.cursor);
}
