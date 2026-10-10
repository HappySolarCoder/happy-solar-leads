"use client";

import { useEffect, useRef, useState } from 'react';
import { Compass, X } from 'lucide-react';
import MobileDialog from './MobileDialog';
import { compassDirection, smoothHeading, type CompassReading } from '@/app/utils/compass';
import { requestCompassAccess, watchCompass } from '@/app/utils/compassSensor';

export default function FieldCompass() {
  const [open,setOpen]=useState(false);
  const [enabled,setEnabled]=useState(false);
  const [requesting,setRequesting]=useState(false);
  const [visible,setVisible]=useState(true);
  const [reading,setReading]=useState<CompassReading|null>(null);
  const [error,setError]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    const visibility=()=>{setVisible(!document.hidden);setReading(null);};
    document.addEventListener('visibilitychange',visibility);
    return ()=>{mounted.current=false;document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{
    if(!enabled || !visible) return;
    const abort=new AbortController();
    let previous:number|null=null;
    let last=Date.now();
    let received=false;
    let cleanup:(()=>void)|undefined;
    void watchCompass(next=>{
      last=Date.now();received=true;
      previous=next.heading===null?null:smoothHeading(previous,next.heading);
      setReading({...next,heading:previous});setError('');
    },abort.signal).then(stop=>{cleanup=stop;if(abort.signal.aborted)stop();}).catch(cause=>{
      if(!abort.signal.aborted){setReading(null);setError(cause instanceof Error?cause.message:'Compass is unavailable on this device.');}
    });
    const timer=window.setInterval(()=>{
      if(Date.now()-last > (received?4000:8000)) {
        previous=null;setReading(null);setError('No compass reading. Hold the phone flat, away from metal, or turn it off and retry.');
      }
    },1000);
    return ()=>{abort.abort();cleanup?.();window.clearInterval(timer);};
  },[enabled,visible]);
  async function turnOn() {
    setRequesting(true);setError('');setReading(null);
    try {await requestCompassAccess();if(mounted.current)setEnabled(true);}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Compass access was not allowed.');}
    finally {if(mounted.current)setRequesting(false);}
  }
  const heading=reading?.heading;
  const value=heading==null?'—':`${compassDirection(heading)} ${Math.round(heading)%360}°`;
  const message=error || (reading?.status==='flat'?'Hold the phone flatter, screen facing up.':reading?.status==='calibrate'?'Move the phone in a figure eight, away from cars and metal.':enabled?'Point the top of the screen in the direction you want to check.':'The map stays north-up. Turn on the compass to see where your phone points.');
  return <>
    <button type="button" className="rm-compass" onClick={()=>setOpen(true)} aria-label={heading==null?'Open compass, map north is up':`Open compass, phone points ${value}`}>
      <span className="rm-compass-rose" aria-hidden="true"><b>N</b><svg viewBox="0 0 32 32" style={{transform:`rotate(${heading??0}deg)`}}><path d="M16 4 23 25 16 21 9 25Z" fill={heading==null?'#587E98':'#F0BC18'} stroke="#304B5E" strokeWidth="1.5"/></svg></span>
      <span><strong>{heading==null?'North ↑':value}</strong><small>{enabled?(heading==null?'Check compass':'Phone points'):'Compass'}</small></span>
    </button>
    {open && <MobileDialog title="Compass & roof direction" onClose={()=>setOpen(false)}>
      <div className="rm-panel-heading"><h2>Compass & roof direction</h2><button type="button" onClick={()=>setOpen(false)} aria-label="Close compass"><X size={22}/></button></div>
      <div className="rm-compass-display" aria-label={`Phone direction ${value}`}><Compass size={30}/><strong>{value}</strong><span>{reading?.reference==='magnetic'?'Magnetic north · approximate':reading?'Sensor north · approximate':'Phone direction'}</span></div>
      <p role="status">{message}</p>
      <button type="button" className="rm-primary rm-full" disabled={requesting} onClick={enabled?()=>{setEnabled(false);setReading(null);setError('');}:turnOn}>{requesting?'Allowing compass…':enabled?'Turn off compass':'Turn on compass'}</button>
      <div className="rm-compass-guide"><h3>Which way does the house face?</h3><p>Hold your phone flat. At the front of the house, point the top of the screen outward toward the street to estimate the front-facing direction.</p><h3>Check a roof slope</h3><p>In Satellite view, north is up, east is right, south is down, and west is left. Follow the slope from its ridge down toward the gutter. Different sides of a roof face different directions.</p><p>Phone direction is an estimate, not an automatic roof measurement. Magnetic north can differ from map north, and metal can affect the reading.</p></div>
    </MobileDialog>}
  </>;
}
