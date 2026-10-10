import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { orientationReading, type CompassReading, type OrientationSample } from './compass';

interface NativeCompass {
  start(options:{sessionId:string}):Promise<void>;
  stop(options:{sessionId:string}):Promise<void>;
  addListener(name:'heading', listener:(event:CompassReading & {sessionId:string})=>void):Promise<PluginListenerHandle>;
}
const compass=registerPlugin<NativeCompass>('RaydarCompass');
type OrientationClass = typeof DeviceOrientationEvent & {requestPermission?:(absolute?:boolean)=>Promise<string>};

/** Must be called from the user's tap, before entering any effect. */
export async function requestCompassAccess():Promise<void> {
  if (Capacitor.getPlatform()==='android' && Capacitor.isPluginAvailable('RaydarCompass')) return;
  if (typeof window.DeviceOrientationEvent === 'undefined') throw new Error('Compass is unavailable on this device. The map still points north.');
  const constructor=window.DeviceOrientationEvent as OrientationClass;
  if (constructor.requestPermission && await constructor.requestPermission(true)!=='granted') throw new Error('Compass access was not allowed. You can still use the north-up map.');
}

export async function watchCompass(onReading:(reading:CompassReading)=>void, signal:AbortSignal):Promise<()=>void> {
  if(signal.aborted) return ()=>{};
  if(Capacitor.getPlatform()==='android' && Capacitor.isPluginAvailable('RaydarCompass')) {
    const sessionId=`${Date.now()}-${Math.random()}`;
    const listener=await compass.addListener('heading',event=>{
      if(!signal.aborted && event.sessionId===sessionId) onReading(event);
    });
    const cleanup=()=>{void listener.remove();void compass.stop({sessionId}).catch(()=>{});};
    if(signal.aborted){cleanup();return cleanup;}
    signal.addEventListener('abort',cleanup,{once:true});
    try {
      await compass.start({sessionId});
      if(signal.aborted) cleanup();
    } catch(error){cleanup();throw error;}
    return cleanup;
  }
  let last=0;
  const handler=(event:DeviceOrientationEvent)=>{
    if(signal.aborted || performance.now()-last<100) return;
    const angle=window.screen.orientation?.angle ?? (window as Window & {orientation?:number}).orientation ?? 0;
    const reading=orientationReading(event as OrientationSample,angle);
    if(reading){last=performance.now();onReading(reading);}
  };
  window.addEventListener('deviceorientationabsolute',handler);
  window.addEventListener('deviceorientation',handler);
  const cleanup=()=>{
    window.removeEventListener('deviceorientationabsolute',handler);
    window.removeEventListener('deviceorientation',handler);
  };
  signal.addEventListener('abort',cleanup,{once:true});
  return cleanup;
}
