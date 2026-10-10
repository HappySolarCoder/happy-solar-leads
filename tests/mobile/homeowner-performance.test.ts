import test from 'node:test';
import assert from 'node:assert/strict';
import { geohashForLocation } from 'geofire-common';
import { HomeownerLoader, type HomeownerState } from '../../app/homeowners/loader';
import { applyRead, hashNumber, planRanges, TILE_SIZE, type Homeowner, type HomeTile } from '../../app/homeowners/model';

const view = { south:43.15, north:43.154, west:-77.605, east:-77.6, zoom:17 };
const hash = geohashForLocation([43.152,-77.602],9);
const home = {id:'test-home',lat:43.152,lng:-77.602,geohash:hash,geohash5:hash.slice(0,5),address:'1 Fictional St',ownerName:'Fictional Owner'} as Homeowner;
const empty = (tile:string):HomeTile => ({tile,docs:{},receipts:[],touched:0});
const tick = () => new Promise(resolve=>setTimeout(resolve,0));

test('saved-home preview is independent of remote reads; warm memory publishes immediately', async()=>{
  let cloud=0,diskReads=0;
  const loader=new HomeownerLoader({
    read:async(tile)=>{
      diskReads++;
      const lo=hashNumber(tile);
      return applyRead(empty(tile),{lo,hi:lo+TILE_SIZE},tile===home.geohash5?[home]:[],0,view.zoom);
    },
    save:async()=>{},fetch:async()=>{cloud++;throw Error('Preview must not reach Firestore');},online:()=>true,
  });
  const cold:HomeownerState[]=[];
  await loader.preview(view,s=>cold.push(s));
  assert.equal(cold.at(-1)!.homes[0].id,home.id);
  const savedReads=diskReads,warm:HomeownerState[]=[];
  const done=loader.preview(view,s=>warm.push(s));
  assert.equal(warm[0].homes[0].id,home.id,'in-memory homes publish before awaiting anything');
  assert.strictEqual(warm[0].homes,cold.at(-1)!.homes,'unchanged records retain their array identity');
  await done;
  const loaded=await new Promise<HomeownerState>(resolve=>loader.request(view,s=>{if(!s.loading)resolve(s);}));
  assert.strictEqual(loaded.homes,warm[0].homes);
  assert.equal(cloud,0);assert.equal(diskReads,savedReads);
});

test('cold cache lookup overlaps only local I/O, and cached preview never fetches missing ranges', async()=>{
  let inFlight=0,peak=0,cloud=0;
  const loader=new HomeownerLoader({
    read:async(tile)=>{peak=Math.max(peak,++inFlight);await tick();inFlight--;return empty(tile);},
    save:async()=>{},fetch:async()=>{cloud++;return{docs:[],rawCount:0};},online:()=>true,
  });
  const larger={...view,south:43.14,north:43.16,west:-77.62,east:-77.59,zoom:15};
  assert.ok(planRanges(larger).size>1);
  await loader.preview(larger,()=>{});
  assert.ok(peak>1&&peak<=4);assert.equal(cloud,0);
});

test('new homes display before slow local persistence without starting another cloud query', async()=>{
  let release!:()=>void, saveStarted=false, cloud=0;
  const gate=new Promise<void>(resolve=>release=resolve),states:HomeownerState[]=[];
  const loader=new HomeownerLoader({
    read:async(tile)=>empty(tile),
    save:async tile=>{if(tile.docs[home.id]){saveStarted=true;await gate;}},
    fetch:async r=>{cloud++;const n=hashNumber(home.geohash);const docs=n>=r.lo&&n<r.hi?[home]:[];return{docs,rawCount:docs.length};},
    online:()=>true,
  });
  loader.request(view,s=>states.push(s));
  for(let i=0;i<50&&!saveStarted;i++)await tick();
  assert.ok(saveStarted);
  assert.ok(states.at(-1)!.homes.some(h=>h.id===home.id),'the name is visible before persistence completes');
  const cloudAtSave=cloud;
  await tick();assert.equal(cloud,cloudAtSave);
  loader.cancel();release();await tick();
  assert.equal(cloud,cloudAtSave,'cancelled navigation never starts another remote request');
});

test('immediate cache previews preserve the exact cloud-query sequence for repeated navigation', async()=>{
  async function navigate(preview:boolean) {
    const disk=new Map<string,HomeTile>(),requests:{lo:number;hi:number;zoom:number}[]=[];
    let online=true;
    const loader=new HomeownerLoader({
      read:async tile=>disk.get(tile)||empty(tile),save:async tile=>{disk.set(tile.tile,tile);},online:()=>online,
      fetch:async(r,zoom)=>{requests.push({...r,zoom});const n=hashNumber(home.geohash);const docs=n>=r.lo&&n<r.hi?[home]:[];return{docs,rawCount:docs.length};},
    });
    const route=[view,{...view,west:view.west+.001,east:view.east+.001},view,view];
    for(let i=0;i<route.length;i++) {
      if(i===3)online=false;
      if(preview)await loader.preview(route[i],()=>{});
      await new Promise<void>(resolve=>loader.request(route[i],s=>{if(!s.loading)resolve();}));
    }
    return requests;
  }
  assert.deepEqual(await navigate(true),await navigate(false));
});
