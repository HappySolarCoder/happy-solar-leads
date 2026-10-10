import L from 'leaflet';
import { HomeownerCanvas } from '@/app/homeowners/CanvasLayer';
import type { Homeowner } from '@/app/homeowners/model';
const map=L.map('map',{zoomControl:false,attributionControl:false,zoomAnimation:false,inertia:false}).setView([43.152,-77.602],17);
const bounds=map.getBounds();
const homes=Array.from({length:2000},(_,i)=>({id:`fixture-${i}`,lat:bounds.getSouth()+(Math.floor(i/40)+.5)/50*(bounds.getNorth()-bounds.getSouth()),lng:bounds.getWest()+((i%40)+.5)/40*(bounds.getEast()-bounds.getWest()),suspectedRenter:i%3===0}) as Homeowner);
let picked='';
const layer=new HomeownerCanvas(h=>picked=h.id).addTo(map);
layer.update(homes);
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const browser=window as unknown as {benchmark:()=>Promise<unknown>};
browser.benchmark=async()=>{
  await new Promise(resolve=>setTimeout(resolve,100));
  // Access the private draw only in this isolated harness to time exactly the
  // production renderer, without including browser/IPC or map animation time.
  const internal=layer as unknown as {draw:()=>void;hits:Map<string,unknown[]>};
  const original=internal.draw.bind(layer),durations:number[]=[];
  for(let i=0;i<24;i++){await frame();const start=performance.now();original();durations.push(performance.now()-start);}
  let drawingDuringMotion=0;
  internal.draw=()=>{drawingDuringMotion++;original();};
  map.fire('movestart');layer.update([...homes]);await frame();await frame();
  const pausedDraws=drawingDuringMotion;
  map.fire('moveend');await frame();await frame();
  const resumed=drawingDuringMotion>pausedDraws;
  internal.draw=original;
  const first=homes[850];
  map.fire('click',{containerPoint:map.latLngToContainerPoint([first.lat,first.lng]),originalEvent:new MouseEvent('click')});
  const exactHit=picked===first.id;
  for(let i=0;i<12;i++){map.panBy([i%2?12:-12,0],{animate:false});await frame();}
  const panned=homes[920];picked='';map.fire('click',{containerPoint:map.latLngToContainerPoint([panned.lat,panned.lng]),originalEvent:new MouseEvent('click')});
  durations.sort((a,b)=>a-b);
  return {homes:homes.length,medianDrawMs:durations[Math.floor(durations.length/2)],p95DrawMs:durations[Math.floor(durations.length*.95)],pausedDraws,resumed,exactHit,panHit:picked===panned.id,canvasCount:document.querySelectorAll('.raydar-homeowner-canvas').length};
};
