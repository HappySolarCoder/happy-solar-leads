'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Clock, CheckCircle2 } from 'lucide-react';
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

  useEffect(() => {
    async function load() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);
      const rows = await getLeadsAsync();
      setLeads(rows);
      setIsLoading(false);
    }
    load();
  }, [router]);

  const rows = useMemo(() => {
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
        <span className="ml-auto text-xs text-[#718096]">{rows.length} total</span>
      </header>

      <div className="p-4 space-y-3">
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
