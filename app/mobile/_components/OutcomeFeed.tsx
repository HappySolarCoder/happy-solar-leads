'use client';
import { useMemo, useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useDeviceValue } from './useDeviceValue';
import type { Lead } from '@/app/types';
import { AppointmentOutcomeBadge } from '@/app/components/AppointmentOutcomeBadge';
import { outcomeKey, outcomeMessage } from '../_lib/fieldUpdates';

export default function OutcomeFeed({ leads, userId, onLead }: { leads: Lead[]; userId: string; onLead: (lead: Lead) => void }) {
  const [limit, setLimit] = useState(3);
  const [saved, saveSeen] = useDeviceValue(`raydar-outcomes-v1:${userId}`, 'localStorage');
  const seen = useMemo<string[]>(() => {
    try {
      const value = JSON.parse(saved || '[]');
      return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(-500) : [];
    } catch { return []; }
  }, [saved]);
  const seenSet = new Set(seen);
  const unread = leads.filter(lead => !seenSet.has(outcomeKey(lead))).length;
  function read(items: Lead[]) {
    const next = [...new Set([...seen, ...items.map(outcomeKey)])].slice(-500);
    saveSeen(JSON.stringify(next));
  }
  return <section className="rm-outcome-feed" aria-label="Your appointment results">
    <div className="rm-results-heading"><div><span className="rm-eyebrow">BEYOND THE DOOR</span><h2>Your work keeps moving.</h2></div><Sparkles size={24} aria-hidden="true" /></div>
    <p>Up to 100 latest outcomes for your assigned or claimed pins. {unread ? `${unread} unseen on this device.` : 'You’re caught up on this device.'}</p>
    {!leads.length ? <div className="rm-empty-inline">When an appointment outcome syncs, it will appear here.</div> : <>
      <div className="rm-agenda">{leads.slice(0, limit).map(lead => <button className="rm-lead-row" key={lead.id} onClick={() => { read([lead]); onLead(lead); }}>
        <span className="rm-lead-copy"><strong>{lead.address}</strong><span>{outcomeMessage(lead)}</span><AppointmentOutcomeBadge lead={lead} />
          {lead.ghlLastUpdatedAt && Number.isFinite(new Date(lead.ghlLastUpdatedAt).getTime()) && <small>Synced {new Date(lead.ghlLastUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</small>}
        </span>{!seenSet.has(outcomeKey(lead)) && <span className="rm-unseen">Unseen</span>}<ChevronRight size={18} aria-hidden="true" />
      </button>)}</div>
      <div className="rm-results-actions">{leads.length > limit && <button onClick={() => setLimit(value => value + 10)}>Show more</button>}{unread > 0 && <button onClick={() => read(leads)}>Mark all seen</button>}</div>
    </>}
    <small>Latest status, not a complete event history. “Synced” is when the record was refreshed.</small>
  </section>;
}
