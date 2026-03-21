'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Clock, CheckCircle2, RefreshCw } from 'lucide-react';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { getLeadsAsync } from '@/app/utils/storage';
import { Lead, User } from '@/app/types';

function isAppointmentLead(lead: Lead) {
  const s = String(lead.status || '').toLowerCase();
  const d = String(lead.disposition || '').toLowerCase();
  return s.includes('appointment') || d.includes('appointment') || s === 'sale';
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'no-show' | 'rescheduled'>('all');

  const reloadLeads = async () => {
    const rows = await getLeadsAsync();
    setLeads(rows);
  };

  useEffect(() => {
    async function load() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      await reloadLeads();
      setIsLoading(false);
    }
    load();
  }, [router]);

  const handleSync = async () => {
    if (!(currentUser?.role === 'admin' || currentUser?.role === 'manager')) return;
    try {
      setIsSyncing(true);
      const { auth } = await import('@/app/utils/firebase');
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return;

      const res = await fetch('/api/appointments/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      await reloadLeads();
    } catch (e) {
      console.error('Appointments sync failed:', e);
      alert('Sync failed. Check server logs.');
    } finally {
      setIsSyncing(false);
    }
  };

  const baseRows = useMemo(() => {
    const appointmentLeads = leads.filter(isAppointmentLead);

    const mine = appointmentLeads.filter((l) => {
      if (!currentUser) return false;
      const actor = l.dispositionHistory?.[0]?.userId || l.claimedBy || l.assignedTo;
      return actor === currentUser.id;
    });

    const canSeeAll = currentUser?.role === 'admin' || currentUser?.role === 'manager';
    const scoped = canSeeAll ? appointmentLeads : mine;

    return scoped.sort((a, b) => {
      const at = a.dispositionedAt ? new Date(a.dispositionedAt).getTime() : 0;
      const bt = b.dispositionedAt ? new Date(b.dispositionedAt).getTime() : 0;
      return bt - at;
    });
  }, [leads, currentUser]);

  const rows = useMemo(() => {
    const norm = (v: unknown) => String(v || '').toLowerCase();
    return baseRows.filter((l) => {
      const outcome = norm((l as any).appointmentOutcome || (l as any).ghlStatus);
      const searchHit = !search || norm(l.address).includes(norm(search)) || norm(l.name).includes(norm(search));

      let outcomeHit = true;
      if (outcomeFilter === 'pending') outcomeHit = !outcome;
      else if (outcomeFilter === 'won') outcomeHit = outcome.includes('won') || outcome.includes('closed won') || outcome.includes('sale');
      else if (outcomeFilter === 'lost') outcomeHit = outcome.includes('lost') || outcome.includes('closed lost');
      else if (outcomeFilter === 'no-show') outcomeHit = outcome.includes('no show') || outcome.includes('noshow');
      else if (outcomeFilter === 'rescheduled') outcomeHit = outcome.includes('rescheduled') || outcome.includes('reschedule');

      return searchHit && outcomeHit;
    });
  }, [baseRows, search, outcomeFilter]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const won = rows.filter((l) => String((l as any).appointmentOutcome || (l as any).ghlStatus || '').toLowerCase().includes('won')).length;
    const pending = rows.filter((l) => !((l as any).appointmentOutcome || (l as any).ghlStatus)).length;
    const setToday = rows.filter((l) => {
      if (!l.dispositionedAt) return false;
      const d = new Date(l.dispositionedAt);
      const n = new Date();
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    }).length;
    return { total, won, pending, setToday };
  }, [rows]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-[#718096]">Loading appointments…</div>;
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <header className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.push('/tools')} className="p-2 rounded-lg hover:bg-[#F7FAFC]">
          <ArrowLeft className="w-5 h-5 text-[#718096]" />
        </button>
        <h1 className="text-lg font-bold text-[#2D3748]">Appointments</h1>
        {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="ml-auto mr-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F7FAFC] disabled:opacity-60"
          >
            <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} /> Sync CRM
          </button>
        )}
        <span className="text-xs text-[#718096]">{rows.length} total</span>
      </header>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Total</div><div className="text-lg font-bold">{kpis.total}</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Set Today</div><div className="text-lg font-bold">{kpis.setToday}</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Won</div><div className="text-lg font-bold">{kpis.won}</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Pending</div><div className="text-lg font-bold">{kpis.pending}</div></div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search address or name"
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
          />
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as any)}
            className="w-full px-3 py-2 border border-[#E2E8F0] rounded-lg text-sm"
          >
            <option value="all">All outcomes</option>
            <option value="pending">Pending</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="no-show">No Show</option>
            <option value="rescheduled">Rescheduled</option>
          </select>
        </div>
        {rows.map((lead) => {
          const appointmentDateTime = (lead as any).appointmentDateTime;
          const ghlStatus = (lead as any).ghlStatus;
          const outcome = (lead as any).appointmentOutcome;
          const setterName = lead.dispositionHistory?.[0]?.userName || 'Unknown';

          return (
            <div key={lead.id} className="bg-white border border-[#E2E8F0] rounded-xl p-4">
              <div className="font-semibold text-[#2D3748]">{lead.address}</div>
              <div className="text-sm text-[#718096] mt-1">{lead.city}, {lead.state} {lead.zip}</div>
              <div className="text-xs text-[#4A5568] mt-1">Setter: <span className="font-semibold">{setterName}</span></div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="inline-flex items-center gap-1 text-[#4A5568]"><Calendar className="w-3 h-3" /> Set: {lead.dispositionedAt ? new Date(lead.dispositionedAt).toLocaleString() : '—'}</div>
                <div className="inline-flex items-center gap-1 text-[#4A5568]"><Clock className="w-3 h-3" /> Appt: {appointmentDateTime ? new Date(appointmentDateTime).toLocaleString() : 'Pending sync'}</div>
                <div className="inline-flex items-center gap-1 text-[#4A5568]"><CheckCircle2 className="w-3 h-3" /> Outcome: {outcome || ghlStatus || 'Pending'}</div>
              </div>
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="text-center text-[#718096] py-12">No appointments yet.</div>
        )}
      </div>
    </div>
  );
}
