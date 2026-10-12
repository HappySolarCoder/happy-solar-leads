import { NextRequest, NextResponse } from 'next/server';
import { authorizedTerritoryWorker, runTerritoryAssignment } from '@/app/utils/server/territoryQueue';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(req:NextRequest) {
  if(!authorizedTerritoryWorker(req.headers.get('x-raydar-task-secret')))return NextResponse.json({error:'Unauthorized'},{status:401});
  try {await runTerritoryAssignment(await req.json());return NextResponse.json({ok:true});}
  catch(e) {
    // All failures remain retryable with a bounded queue policy. A manager can
    // retry after correcting permissions; never silently acknowledge lost work.
    console.error('Territory worker failed',{code:(e as {status?:number}).status || 500});
    return NextResponse.json({error:'Assignment pending. Retry from Manage territories if progress stops.'},{status:503});
  }
}
