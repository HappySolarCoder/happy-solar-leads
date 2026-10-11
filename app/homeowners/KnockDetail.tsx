'use client';
import { useState } from 'react';
import LeadDetail from '@/app/components/LeadDetail';
import type { Lead, User } from '@/app/types';
import type { Disposition } from '@/app/types/disposition';
import type { HomeownerVisit } from './visit';

export default function HomeownerKnockDetail({ visit, currentUser, dispositions, loading, onClose, onUpdate }: {
  visit: HomeownerVisit; currentUser: User; dispositions: Disposition[]; loading: boolean;
  onClose: () => void; onUpdate: (updatedLead?: Lead) => void;
}) {
  const [lead, setLead] = useState(visit.lead);
  return <LeadDetail lead={lead} homeowner={lead.homeowner} currentUser={currentUser}
    fieldMemory unvisitedHome={!visit.saved} dispositionOptions={dispositions} dispositionsLoading={loading}
    saveLeadPatch={async patch => {
      if (loading) throw Error('Wait for your pins and actions to finish loading, then retry.');
      setLead(await visit.save(patch)); onUpdate();
    }}
    prepareLead={async () => {
      if (loading) throw Error('Wait for your pins and actions to finish loading, then retry.');
      await visit.prepare(); setLead(visit.lead);
    }}
    onClose={onClose} onUpdate={onUpdate} />;
}
