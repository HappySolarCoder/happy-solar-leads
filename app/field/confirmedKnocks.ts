import type { Lead } from '@/app/types';
import type { PendingMutation } from './types';

/** Keep a confirmed knock visible until the live listener catches up. */
export function unreflectedKnocks(knocks: PendingMutation[], leads: Lead[], uid: string) {
  const byId = new Map(leads.map(lead => [lead.id, lead]));
  return knocks.filter(m => {
    if (m.userId !== uid || m.kind !== 'knock') return false;
    const lead = byId.get(m.leadId);
    return !lead?.dispositionedAt || new Date(lead.dispositionedAt).getTime() < Date.parse(m.createdAt);
  });
}
