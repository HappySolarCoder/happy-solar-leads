import type { Lead } from '@/app/types';
import { getAppointmentOutcome } from '@/app/utils/appointmentOutcome';
import { isScheduledGoBackStatus } from '@/app/types/disposition';
import { calculateDistance, type GpsPosition } from '@/app/hooks/useGeolocation';

export function isPersonalLead(lead: Lead, userId: string): boolean {
  return !lead.historicalTerritoryPin &&
    (lead.claimedBy ? lead.claimedBy === userId : lead.assignedTo === userId);
}
const eastern = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function clock(date: Date) {
  if (!Number.isFinite(date.getTime())) return null;
  const p = Object.fromEntries(eastern.formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function scheduledMinutes(time?: string): number | null {
  const match = time?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]) hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  return hour * 60 + minute;
}
export function returnVisitKey(lead: Lead): string {
  return `${lead.id}:${lead.goBackScheduledDate ? new Date(lead.goBackScheduledDate).getTime() : ''}:${lead.goBackScheduledTime || ''}`;
}
export function nearbyReturns(leads: Lead[], userId: string, position: GpsPosition | null, now: Date) {
  const current = clock(now);
  if (!current || !position || !Number.isFinite(position.accuracy) || position.accuracy > 100 ||
      !Number.isFinite(position.timestamp) || Math.abs(now.getTime() - position.timestamp) > 120000 ||
      !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return [];
  return leads.flatMap(lead => {
    if (!isPersonalLead(lead, userId) || !isScheduledGoBackStatus(lead.status) ||
        !lead.goBackScheduledDate || !Number.isFinite(lead.lat) || !Number.isFinite(lead.lng)) return [];
    const outcome = getAppointmentOutcome(lead)?.key;
    if (outcome === 'sold' || outcome === 'scheduled' || lead.leadType === 'sale' || lead.leadType === 'customer') return [];
    const due = clock(new Date(lead.goBackScheduledDate));
    const minute = scheduledMinutes(lead.goBackScheduledTime);
    // An exact agreed time is required; never guess a window for an anytime visit.
    if (!due || due.day !== current.day || minute === null || current.minutes < minute || current.minutes >= minute + 60) return [];
    const distance = calculateDistance(position.lat, position.lng, lead.lat!, lead.lng!);
    return distance <= 0.25 ? [{ lead, distance, key: returnVisitKey(lead) }] : [];
  }).sort((a, b) => a.distance - b.distance);
}

// The sync timestamp is NOT the outcome event time. It must not cause repeated
// unread badges when GHL syncs the same outcome again.
export function outcomeKey(lead: Lead): string {
  const outcome = getAppointmentOutcome(lead);
  return `${lead.id}:${outcome?.key === 'other' ? outcome.label : outcome?.key}:${lead.appointmentDateTime ? new Date(lead.appointmentDateTime).getTime() : ''}`;
}
export function personalOutcomeLeads(leads: Lead[], userId: string): Lead[] {
  return leads.filter(lead => isPersonalLead(lead, userId) && getAppointmentOutcome(lead))
    .sort((a, b) => (new Date(b.ghlLastUpdatedAt || 0).getTime() || 0) - (new Date(a.ghlLastUpdatedAt || 0).getTime() || 0)).slice(0, 100);
}
export function outcomeMessage(lead: Lead): string {
  switch (getAppointmentOutcome(lead)?.key) {
    case 'sold': return 'Your lead is now marked Sold.';
    case 'show': return 'Your appointment is marked Show.';
    case 'noshow': return 'Your appointment was marked No show.';
    case 'rescheduled': return 'Your appointment was rescheduled.';
    case 'cancelled': return 'Your appointment was cancelled.';
    case 'lost': return 'Your lead was marked Lost.';
    case 'scheduled': return 'Your appointment is on the calendar.';
    default: return 'An appointment outcome is available.';
  }
}
export function doorstepMemory(lead: Lead) {
  const outcome = getAppointmentOutcome(lead);
  const next = outcome?.key === 'sold' ? 'Sold — no return knock needed.'
    : isScheduledGoBackStatus(lead.status) && lead.goBackScheduledDate ? 'Return at the agreed time.'
    : outcome?.key === 'scheduled' || lead.status === 'appointment' ? 'Appointment booked — check the handoff details.'
    : ['not-interested', 'do-not-knock', 'do-not-contact'].includes(lead.status) ? 'Respect the recorded contact preference.'
    : 'No next action recorded. Review the notes before following up.';
  return {
    conversation: lead.notes?.trim() || lead.goBackNotes?.trim() || lead.objectionNotes?.trim() || 'No conversation notes yet.',
    next,
    outcome: outcome?.label || 'No appointment outcome yet',
  };
}
