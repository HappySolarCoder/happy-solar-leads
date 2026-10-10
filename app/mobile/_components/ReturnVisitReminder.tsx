'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useDeviceValue } from './useDeviceValue';
import type { Lead } from '@/app/types';
import type { GpsPosition } from '@/app/hooks/useGeolocation';
import { formatGoBackScheduledTime } from '@/app/utils/timezone';
import { nearbyReturns } from '../_lib/fieldUpdates';

export default function ReturnVisitReminder({ leads, userId, position, onLead, previewNow }: {
  leads: Lead[]; userId: string; position: GpsPosition | null; onLead: (lead: Lead) => void; previewNow?: Date;
}) {
  const [now, setNow] = useState(() => previewNow || new Date());
  const [saved, saveHidden] = useDeviceValue(`raydar-returns-v1:${userId}`, 'sessionStorage');
  const hidden = useMemo<Record<string, number>>(() => {
    try {
      const value = JSON.parse(saved || '{}');
      return value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) : {};
    } catch { return {}; }
  }, [saved]);
  useEffect(() => {
    if (previewNow) return;
    const tick = () => { if (document.visibilityState === 'visible') setNow(new Date()); };
    const timer = window.setInterval(tick, 30000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [previewNow]);
  const candidates = useMemo(() => nearbyReturns(leads, userId, position, now), [leads, userId, position, now]);
  const visit = candidates.find(item => !(hidden[item.key] > now.getTime()));
  if (!visit) return null;
  function hide(minutes: number) {
    if (!visit) return;
    const next = Object.fromEntries(Object.entries(hidden).filter(([, until]) => until > now.getTime()));
    next[visit.key] = now.getTime() + minutes * 60000;
    saveHidden(JSON.stringify(next));
  }
  return <aside className="rm-return-reminder" aria-label="Nearby return visit">
    <div className="rm-return-copy" role="status">
      <Bell size={18} aria-hidden="true" />
      <div><strong>Time for your go-back</strong><span>{visit.lead.name || 'Homeowner'} · {formatGoBackScheduledTime(visit.lead.goBackScheduledTime)} ET</span><span>{visit.lead.address} · {Math.round(visit.distance * 5280)} ft away</span></div>
    </div>
    <button className="rm-return-dismiss" aria-label="Dismiss this return reminder" onClick={() => hide(60)}><X size={18} /></button>
    <div className="rm-return-buttons"><button onClick={() => { hide(10); onLead(visit.lead); }}>Open notes</button><button onClick={() => hide(10)}>In 10 min</button></div>
  </aside>;
}
