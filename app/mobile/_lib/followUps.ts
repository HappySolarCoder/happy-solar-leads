import type { Lead } from '@/app/types';
import { isScheduledGoBackLead } from '@/app/types/disposition';

export function isOwnFollowUp(lead: Lead, uid: string): boolean {
  if (!uid || lead.historicalTerritoryPin || !isScheduledGoBackLead(lead)) return false;
  // The scheduler owns the reminder. Older records fall back to their rep.
  return (lead.goBackScheduledBy || lead.claimedBy || lead.assignedTo) === uid;
}

function dateMs(value: unknown): number {
  if (!value) return 0;
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function')
    return (value as { toMillis: () => number }).toMillis();
  return new Date(value as string | Date).getTime();
}

export function followUpRevision(lead: Lead): string {
  return JSON.stringify([lead.id, lead.status, dateMs(lead.goBackScheduledDate),
    lead.goBackScheduledTime || '', lead.goBackScheduledBy || '',
    lead.claimedBy || '', lead.assignedTo || '', dateMs(lead.dispositionedAt)]);
}

export function followUpCleanupPatch(current: Lead, selected: Lead, uid: string) {
  if (!isOwnFollowUp(current, uid) || !isOwnFollowUp(selected, uid) ||
      followUpRevision(current) !== followUpRevision(selected)) return null;
  // Cancel only the reminder. Preserve outcome, attribution, history, notes,
  // appointment fields and ownership. A new go-back can be scheduled normally.
  return { goBackScheduledDate: null, goBackScheduledTime: '' };
}
