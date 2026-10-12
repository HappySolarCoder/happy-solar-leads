import { NextRequest, NextResponse } from 'next/server';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
export function createFeedbackHandlers(deps:{auth:()=>Auth;db:()=>Firestore;bucket:()=>Bucket}) {
const PREFIX='raydar-feedback/';
const MAX_BYTES=2*1024*1024;
async function account(request:NextRequest) {
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!token)throw Object.assign(Error('Sign in to send feedback.'),{status:401});
  const {uid}=await deps.auth().verifyIdToken(token, true);
  const doc=await deps.db().collection('users').doc(uid).get(),user=doc.data();
  if(!user || user.deleted || user.deletionPending || user.isActive===false || user.approved===false || user.approvalStatus==='pending')throw Object.assign(Error('This account is not active.'),{status:403});
  return {uid,user};
}
const bucket=deps.bucket;
function fail(e:any){return NextResponse.json({error:e.status ? e.message : 'Feedback could not be transferred. Your recording stays on the phone.'},{status:e.status || (String(e.code||'').startsWith('auth/')?401:500)});}
async function POST(request:NextRequest) {
  try {
    const {uid,user}=await account(request);
    const text=await request.text();
    if(text.length>3_000_000)throw Object.assign(Error('Use a recording under two minutes.'),{status:413});
    const x=JSON.parse(text),at=Date.parse(x.createdAt);
    const mime=String(x.mime||'').split(';')[0];
    const types:Record<string,string>={'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/aac':'aac'};
    if(!/^[0-9a-f-]{36}$/i.test(x.id) || x.uid!==uid || !Number.isFinite(at) || at>Date.now()+86400000 || at<0 || !types[mime] || typeof x.audio!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(x.audio))throw Object.assign(Error('This recording is invalid.'),{status:400});
    const bytes=Buffer.from(x.audio,'base64');
    if(!bytes.length || bytes.length>MAX_BYTES)throw Object.assign(Error('Use a recording under two minutes.'),{status:413});
    // Deterministic owner-scoped name + create precondition makes network retries idempotent.
    const file=bucket().file(`${PREFIX}${uid}/${String(9999999999999-at).padStart(13,'0')}_${x.id}.${types[mime]}`);
    try {await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:mime,cacheControl:'private, max-age=0',metadata:{uid,name:String(user.name||'').slice(0,150),note:String(x.note||'').slice(0,2000),createdAt:new Date(at).toISOString(),version:String(x.version||'').slice(0,50),platform:String(x.platform||'').slice(0,30)}}});}
    catch(e:any){if(Number(e.code)!==412)throw e;}
    return NextResponse.json({saved:true,id:x.id});
  }catch(e){return fail(e);}
}
async function GET(request:NextRequest) {
  try {
    const {uid,user}=await account(request),all=request.nextUrl.searchParams.get('all')==='1';
    if(all && user.role!=='admin')throw Object.assign(Error('Only admins can review team feedback.'),{status:403});
    const token=request.nextUrl.searchParams.get('cursor')||undefined;
    if(token && token.length>2048)throw Object.assign(Error('Invalid feedback page.'),{status:400});
    const [files,next]=await bucket().getFiles({prefix:all?PREFIX:`${PREFIX}${uid}/`,maxResults:20,autoPaginate:false,pageToken:token});
    const items=await Promise.all(files.map(async file=>({id:file.name,...file.metadata.metadata,bytes:Number(file.metadata.size||0),url:(await file.getSignedUrl({action:'read',expires:Date.now()+15*60000}))[0]})));
    return NextResponse.json({items,cursor:next?.pageToken||null},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){return fail(e);}
}

return {GET,POST};
}
