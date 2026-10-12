"use client";
import { useMemo, useState } from 'react';
import { Flag, X } from 'lucide-react';
import type { Lead } from '@/app/types';
import type { Disposition } from '@/app/types/disposition';
import { sessionAppointments, sessionDoors } from '../_lib/doorCoach';
import { useDeviceNow } from './useDeviceNow';
import MobileDialog from './MobileDialog';
type Session = {
    startedAt: string;
    target: number;
    doorTarget?: number;
};
export default function DoorCoach({ leads, userId, dispositions, now: previewNow }: {
    leads: Lead[];
    userId: string;
    dispositions: Disposition[];
    now?: Date;
}) {
    const deviceNow = useDeviceNow(), now = previewNow || deviceNow;
    const [open, setOpen] = useState(false), [editing, setEditing] = useState(false);
    const [target, setTarget] = useState(2), [doorTarget, setDoorTarget] = useState(''), [error, setError] = useState('');
    const [saved, setSaved] = useState<Session | null>(() => {
        if (typeof window === 'undefined')
            return null;
        try {
            const v = JSON.parse(localStorage.getItem(`raydar-focus:${userId}`) || 'null');
            return v && [1, 2, 3, 4, 5].includes(v.target) && Number.isFinite(Date.parse(v.startedAt)) ? v : null;
        }
        catch {
            return null;
        }
    });
    const session = saved && new Date(saved.startedAt).toDateString() === now.toDateString() ? saved : null;
    const appointments = useMemo(() => session ? sessionAppointments(leads, userId, session.startedAt) : 0, [leads, userId, session]);
    const doors = useMemo(() => session ? sessionDoors(leads, userId, session.startedAt, dispositions) : 0, [leads, userId, session, dispositions]);
    const complete = !!session && appointments >= session.target && (!session.doorTarget || doors >= session.doorTarget);
    function save(value: Session | null) { setSaved(value); try {
        if (value)
            localStorage.setItem(`raydar-focus:${userId}`, JSON.stringify(value));
        else
            localStorage.removeItem(`raydar-focus:${userId}`);
    }
    catch { /* Keep usable in memory. */ } }
    function edit() { setTarget(session?.target || 2); setDoorTarget(session?.doorTarget ? String(session.doorTarget) : ''); setEditing(true); setError(''); }
    function submit(e: React.FormEvent) {
        e.preventDefault();
        const count = Number(doorTarget);
        if (!Number.isSafeInteger(count) || count < 1) {
            setError('Enter a whole number of doors greater than zero.');
            return;
        }
        save({ target, doorTarget: count, startedAt: session?.startedAt || now.toISOString() });
        setEditing(false);
        setError('');
    }
    return <><div className="rm-door-actions"><button onClick={() => { setOpen(true); setEditing(false); setError(''); }} className={complete ? 'is-complete' : ''} aria-label={`Open Focus, ${doors} doors knocked${session?.doorTarget ? ` of ${session.doorTarget}` : ''}, ${appointments} appointments set${session ? ` of ${session.target}` : ''}`}>
    <Flag size={16}/><span>Focus</span><span className="rm-focus-divider"/><span>{doors}{session?.doorTarget ? `/${session.doorTarget}` : ''} doors</span><span className="rm-focus-divider"/><span>{session ? `${appointments}/${session.target}` : appointments} set</span>
  </button></div>{open && <MobileDialog title="Door & appointment focus" onClose={() => setOpen(false)}><div className="rm-coach-panel">
    <div className="rm-panel-heading"><span className="rm-eyebrow">YOUR SESSION GOALS</span><button aria-label="Close focus" onClick={() => setOpen(false)}><X size={22}/></button></div>
    <h2>{complete ? 'Both goals reached. Nice work.' : 'Give this session a purpose.'}</h2>
    {session && !editing ? <><div className="rm-focus-totals"><div><strong>{doors}{session.doorTarget ? ` / ${session.doorTarget}` : ''}</strong><span>doors knocked</span></div><div><strong>{appointments} / {session.target}</strong><span>appointments set</span></div></div>
      <p>Counts your unique doors and appointments since this session started. Editing goals keeps your progress.</p>
      <button className="rm-primary" onClick={() => setOpen(false)}>Back to the doors</button><button className="rm-coach-end" onClick={edit}>Edit goals</button><button className="rm-coach-end" onClick={() => { save(null); edit(); }}>End focus session</button>
    </> : <form onSubmit={submit}>
      <label className="rm-focus-label" htmlFor="focus-doors">Door goal</label><input id="focus-doors" className="rm-focus-input" type="number" inputMode="numeric" min="1" step="1" required value={doorTarget} placeholder="e.g. 50" onChange={e => setDoorTarget(e.target.value)}/>
      <fieldset className="rm-focus-fieldset"><legend>Appointment goal</legend><div className="rm-focus-choices">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} aria-label={`${n} ${n === 1 ? 'appointment' : 'appointments'}`} aria-pressed={target === n} onClick={() => setTarget(n)}><b>{n}</b></button>)}</div></fieldset>
      {error && <p role="alert">{error}</p>}<button className="rm-primary" type="submit">{session ? 'Save goals' : 'Start focus session'}</button>
      {session && <button type="button" className="rm-coach-end" onClick={() => setEditing(false)}>Cancel</button>}
      <small className="rm-coach-footnote">Personal session on this device. Uses your existing lead updates.</small>
    </form>}
  </div></MobileDialog>}</>;
}
