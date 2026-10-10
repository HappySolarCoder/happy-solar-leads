import type {PendingMutation} from './types';
/** Drains newly queued work as well as the initial batch. A transient failure
 * stops the drain without deleting anything; a conflict blocks that door only. */
export async function syncOutbox(deps:{read:()=>Promise<PendingMutation[]>;send:(m:PendingMutation)=>Promise<unknown>;remove:(id:string)=>Promise<unknown>;block:(m:PendingMutation)=>Promise<unknown>;active:()=>boolean}){
  const blocked=new Set<string>(),seen=new Set<string>();let accepted=0;
  while(deps.active()){
    const batch=(await deps.read()).filter(m=>!seen.has(m.id));if(!batch.length)break;
    for(const m of batch){
      if(!deps.active())return {accepted};seen.add(m.id);
      if(m.blocked||blocked.has(m.leadId)){blocked.add(m.leadId);continue;}
      try{await deps.send(m);await deps.remove(m.id);accepted++;}
      catch(e){const error=e as Error&{status?:number};if([400,403,404,409,413].includes(error.status||0)){await deps.block({...m,blocked:true,error:error.message});blocked.add(m.leadId);}else return {accepted,error:error.message};}
    }
  }
  return{accepted};
}
