/** Native DOM touches work in WKWebView; Leaflet does not emit map touchstart.
 * Passive observation preserves scrolling/pinch. Only a completed hold consumes
 * the trailing tap. No pointer capture or per-move React updates. */
export function attachMapLongPress(element: HTMLElement, onHold: (point: {clientX:number;clientY:number}) => void, enabled: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined, start: {clientX:number;clientY:number} | null = null;
  let touchAt=0, suppressUntil=0;
  const cancel=()=>{clearTimeout(timer);timer=undefined;start=null;};
  const blocked=(target:EventTarget|null)=>target instanceof Element && !!target.closest('.leaflet-control,.leaflet-popup,.leaflet-marker-icon,button,a,input');
  const begin=(point:{clientX:number;clientY:number},target:EventTarget|null)=>{
    cancel(); if(!enabled() || blocked(target))return;
    start={clientX:point.clientX,clientY:point.clientY};
    timer=setTimeout(()=>{const point=start;cancel();if(point && enabled()){suppressUntil=Date.now()+1000;onHold(point);}},700);
  };
  const move=(point:{clientX:number;clientY:number})=>{if(start && Math.hypot(point.clientX-start.clientX,point.clientY-start.clientY)>12)cancel();};
  const touchStart=(e:TouchEvent)=>{touchAt=Date.now();if(e.touches.length!==1){cancel();return;}begin(e.touches[0],e.target);};
  const touchMove=(e:TouchEvent)=>{if(e.touches.length!==1)cancel();else move(e.touches[0]);};
  const finish=(e:Event)=>{cancel();if(Date.now()<suppressUntil){if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();}};
  const mouseDown=(e:MouseEvent)=>{if(e.button===0 && Date.now()-touchAt>1000)begin(e,e.target);};
  const mouseMove=(e:MouseEvent)=>move(e);
  const click=(e:MouseEvent)=>{if(Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}};
  const context=(e:MouseEvent)=>{e.preventDefault();e.stopImmediatePropagation();cancel();if(Date.now()>=suppressUntil && enabled() && !blocked(e.target)){suppressUntil=Date.now()+1000;onHold(e);}};
  element.addEventListener('touchstart',touchStart,{passive:true,capture:true});
  element.addEventListener('touchmove',touchMove,{passive:true,capture:true});
  element.addEventListener('mousedown',mouseDown,true);
  element.addEventListener('contextmenu',context,true);
  element.addEventListener('click',click,true);
  document.addEventListener('touchend',finish,{capture:true,passive:false});
  document.addEventListener('touchcancel',cancel,true);
  document.addEventListener('mouseup',finish,true);
  document.addEventListener('mousemove',mouseMove,true);
  document.addEventListener('visibilitychange',cancel);
  window.addEventListener('blur',cancel);
  return {cancel,destroy:()=>{
    cancel();element.removeEventListener('touchstart',touchStart,true);element.removeEventListener('touchmove',touchMove,true);
    element.removeEventListener('mousedown',mouseDown,true);element.removeEventListener('contextmenu',context,true);element.removeEventListener('click',click,true);
    document.removeEventListener('touchend',finish,true);document.removeEventListener('touchcancel',cancel,true);
    document.removeEventListener('mouseup',finish,true);document.removeEventListener('mousemove',mouseMove,true);
    document.removeEventListener('visibilitychange',cancel);window.removeEventListener('blur',cancel);
  }};
}
