'use client';
import { useEffect } from 'react';
import { startupEvent } from './_lib/startupDiagnostics';
export default function MobileError({reset}:{error:Error;reset:()=>void}) {
  useEffect(()=>startupEvent('mobile-screen-error'),[]);
  return <main className="rm-loading"><h1>Let’s reopen this screen</h1><p>Raydar had trouble displaying the page. Your saved knocks remain on this phone.</p><button className="rm-primary" onClick={reset}>Try again</button><button className="rm-secondary" onClick={()=>window.location.reload()}>Reload Raydar</button></main>;
}
