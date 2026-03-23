'use client';

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

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

function normalizeOutcomeLabel(v: unknown) {
  const raw = String(v || '').trim();
  if (!raw) return 'Pending';
  const s = raw.toLowerCase();
  if (s.includes('no sit')) return 'No Show';
  if (s.includes('no show') || s.includes('noshow')) return 'No Show';
  if (s.includes('sit')) return 'Show';
  if (s.includes('show')) return 'Show';
  if (s.includes('new appointment')) return 'Pending';
  if (s.includes('sold') || s.includes('won')) return 'Sold';
  if (s.includes('lost')) return 'Lost';
  if (s.includes('resched')) return 'Rescheduled';
  return raw;
}

function outcomeBadgeClass(label: string) {
  switch (label) {
    case 'Show': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'No Show': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'Sold': return 'bg-green-50 text-green-700 border-green-200';
    case 'Lost': return 'bg-red-50 text-red-700 border-red-200';
    case 'Rescheduled': return 'bg-purple-50 text-purple-700 border-purple-200';
    default: return 'bg-gray-50 text-gray-700 border-gray-200';
  }
}

function parseMaybeDateTime(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    const nanoseconds = Number((value as { nanoseconds?: unknown }).nanoseconds || 0);
    if (Number.isFinite(seconds)) {
      const parsed = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function formatMaybeDateTime(value: unknown, fallback = 'Pending sync') {
  const date = parseMaybeDateTime(value);
  return date ? date.toLocaleString() : fallback;
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);
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

      if (user.role === 'admin' || user.role === 'manager') {
        const status = await loadSyncStatus();
        const lastSuccess = parseMaybeDateTime(status?.lastSuccessAt)?.getTime() || 0;
        if (!lastSuccess || Date.now() - lastSuccess > 5 * 60 * 1000) {
          await handleSync();
        }
      }

      setIsLoading(false);
    }
    load();
  }, [router]);

  const loadSyncStatus = async () => {
    try {
      const { auth } = await import('@/app/utils/firebase');
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return null;
      const res = await fetch('/api/admin/sync-appointments', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const json = await res.json();
      setSyncStatus(json?.status || null);
      return json?.status || null;
    } catch {
      return null;
    }
  };

  const handleSync = async () => {
    if (!(currentUser?.role === 'admin' || currentUser?.role === 'manager')) return;
    try {
      setIsSyncing(true);
      const { auth } = await import('@/app/utils/firebase');
      const token = await auth?.currentUser?.getIdToken();
      if (!token) return;

      const res = await fetch('/api/admin/sync-appointments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      await reloadLeads();
      await loadSyncStatus();
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
      const outcomeLabel = normalizeOutcomeLabel((l as any).appointmentOutcome || (l as any).ghlStatus);
      const outcome = norm(outcomeLabel);
      const searchHit = !search || norm(l.address).includes(norm(search)) || norm(l.name).includes(norm(search));

      let outcomeHit = true;
      if (outcomeFilter === 'pending') outcomeHit = outcomeLabel === 'Pending';
      else if (outcomeFilter === 'won') outcomeHit = outcome.includes('sold') || outcome.includes('won') || outcome.includes('closed won') || outcome.includes('sale');
      else if (outcomeFilter === 'lost') outcomeHit = outcome.includes('lost') || outcome.includes('closed lost');
      else if (outcomeFilter === 'no-show') outcomeHit = outcome.includes('no show') || outcome.includes('noshow');
      else if (outcomeFilter === 'rescheduled') outcomeHit = outcome.includes('rescheduled') || outcome.includes('reschedule');

      return searchHit && outcomeHit;
    });
  }, [baseRows, search, outcomeFilter]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const sold = rows.filter((l) => normalizeOutcomeLabel((l as any).appointmentOutcome || (l as any).ghlStatus) === 'Sold').length;
    const show = rows.filter((l) => normalizeOutcomeLabel((l as any).appointmentOutcome || (l as any).ghlStatus) === 'Show').length;
    const noShow = rows.filter((l) => normalizeOutcomeLabel((l as any).appointmentOutcome || (l as any).ghlStatus) === 'No Show').length;
    const pending = rows.filter((l) => !((l as any).appointmentOutcome || (l as any).ghlStatus)).length;
    const showRate = total ? Math.round((show / total) * 100) : 0;
    const noShowRate = total ? Math.round((noShow / total) * 100) : 0;
    const wonRate = total ? Math.round((sold / total) * 100) : 0;
    return { total, sold, pending, showRate, noShowRate, wonRate };
  }, [rows]);

  const setterAnalytics = useMemo(() => {
    const map = new Map<string, { name: string; total: number; show: number; noShow: number; sold: number; lost: number; rescheduled: number; pending: number }>();

    rows.forEach((lead) => {
      const setterName = lead.dispositionHistory?.[0]?.userName || 'Unknown';
      const outcome = normalizeOutcomeLabel((lead as any).appointmentOutcome || (lead as any).ghlStatus);
      const current = map.get(setterName) || { name: setterName, total: 0, show: 0, noShow: 0, sold: 0, lost: 0, rescheduled: 0, pending: 0 };
      current.total += 1;
      if (outcome === 'Show') current.show += 1;
      else if (outcome === 'No Show') current.noShow += 1;
      else if (outcome === 'Sold') current.sold += 1;
      else if (outcome === 'Lost') current.lost += 1;
      else if (outcome === 'Rescheduled') current.rescheduled += 1;
      else current.pending += 1;
      map.set(setterName, current);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        showRate: row.total ? Math.round((row.show / row.total) * 100) : 0,
        noShowRate: row.total ? Math.round((row.noShow / row.total) * 100) : 0,
        wonRate: row.total ? Math.round((row.sold / row.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total || b.wonRate - a.wonRate);
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
        {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && syncStatus && (
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3 text-xs text-[#4A5568]">
            Sync: <span className="font-semibold">{syncStatus.state || 'idle'}</span>
            {syncStatus.lastSuccessAt && <> • Last success: <span className="font-semibold">{formatMaybeDateTime(syncStatus.lastSuccessAt, 'Unknown')}</span></>}
            {typeof syncStatus.skippedAmbiguous === 'number' && <> • Skipped ambiguous: <span className="font-semibold">{syncStatus.skippedAmbiguous}</span></>}
            {typeof syncStatus.lastRunUnmatched === 'number' && <> • Unmatched: <span className="font-semibold">{syncStatus.lastRunUnmatched}</span></>}
            {syncStatus.lastError && <> • Last error: <span className="font-semibold text-red-600">{syncStatus.lastError}</span></>}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Total</div><div className="text-lg font-bold">{kpis.total}</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Show Rate</div><div className="text-lg font-bold">{kpis.showRate}%</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">No Show Rate</div><div className="text-lg font-bold">{kpis.noShowRate}%</div></div>
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-3"><div className="text-xs text-[#718096]">Won Rate</div><div className="text-lg font-bold">{kpis.wonRate}%</div></div>
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

        <div className="bg-white border border-[#E2E8F0] rounded-lg p-3">
          <div className="text-sm font-semibold text-[#2D3748] mb-3">Setter Feedback Analytics</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#718096] border-b border-[#E2E8F0]">
                  <th className="py-2 pr-3">Setter</th>
                  <th className="py-2 pr-3">Set</th>
                  <th className="py-2 pr-3">Show%</th>
                  <th className="py-2 pr-3">No Show%</th>
                  <th className="py-2 pr-3">Won%</th>
                </tr>
              </thead>
              <tbody>
                {setterAnalytics.map((row) => (
                  <tr key={row.name} className="border-b border-[#F1F5F9] last:border-0">
                    <td className="py-2 pr-3 font-medium text-[#2D3748]">{row.name}</td>
                    <td className="py-2 pr-3">{row.total}</td>
                    <td className="py-2 pr-3">{row.showRate}%</td>
                    <td className="py-2 pr-3">{row.noShowRate}%</td>
                    <td className="py-2 pr-3">{row.wonRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {rows.map((lead) => {
          const appointmentDateTime = (lead as any).appointmentDateTime;
          const ghlStatus = (lead as any).ghlStatus;
          const outcome = normalizeOutcomeLabel((lead as any).appointmentOutcome || (lead as any).ghlStatus);
          const setterName = lead.dispositionHistory?.[0]?.userName || 'Unknown';

          return (
            <div key={lead.id} className="bg-white border border-[#E2E8F0] rounded-xl p-4">
              <div className="font-semibold text-[#2D3748]">{lead.name || 'Unknown Lead'}</div>
              <div className="text-sm text-[#718096] mt-1">{lead.address}</div>
              <div className="text-sm text-[#718096] mt-1">{lead.city}, {lead.state} {lead.zip}</div>
              <div className="text-xs text-[#4A5568] mt-1">Setter: <span className="font-semibold">{setterName}</span></div>
              <div className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[#2D3748]"><Clock className="w-4 h-4" /> Appointment: {formatMaybeDateTime(appointmentDateTime)}</div>
              <div className={`mt-2 inline-flex px-2 py-1 rounded-full border text-xs font-semibold ${outcomeBadgeClass(outcome)}`}>{outcome}</div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="inline-flex items-center gap-1 text-[#4A5568]"><Calendar className="w-3 h-3" /> Set: {formatMaybeDateTime(lead.dispositionedAt, '—')}</div>
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
