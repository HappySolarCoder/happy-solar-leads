'use client';
import { isScheduledGoBackStatus } from '@/app/types/disposition';
import type { Lead } from '@/app/types';
import { doorstepMemory } from '@/app/mobile/_lib/fieldUpdates';
import { formatGoBackScheduledTime, formatDateEST } from '@/app/utils/timezone';
export default function DoorstepMemory({ lead, onNote }: { lead: Lead; onNote?: (note: string) => void }) {
  if (lead.historicalTerritoryPin) return null;
  const memory = doorstepMemory(lead);
  return <section className="mb-4 rounded-2xl border border-[#bed5c9] bg-[#f1f7f0] p-4" aria-label="Doorstep memory">
    <h3 className="text-base font-bold text-[#244f45]">Before you knock</h3>
    <dl className="mt-3 space-y-3 text-sm text-[#344d49]">
      <div><dt className="font-semibold">Last conversation / saved notes</dt><dd className="mt-1 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">{memory.conversation}</dd></div>
      <div><dt className="font-semibold">Next action</dt><dd className="mt-1">{memory.next}</dd>{lead.goBackScheduledDate && isScheduledGoBackStatus(lead.status) && <dd>{formatDateEST(lead.goBackScheduledDate)} · {formatGoBackScheduledTime(lead.goBackScheduledTime) || 'Anytime'} ET</dd>}{lead.goBackNotes && <dd className="mt-1 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">{lead.goBackNotes}</dd>}</div>
      <div><dt className="font-semibold">Appointment outcome</dt><dd className="mt-1">{memory.outcome}</dd></div>
    </dl>
    {onNote && <div className="mt-4"><p className="text-xs mb-2">Add to your note draft, then review and save:</p><div className="flex flex-wrap gap-2">{['Asked for spouse to be home', 'Wanted financing information', 'Asked about roof suitability'].map(note => <button key={note} type="button" className="min-h-11 rounded-xl border border-[#b8cdbf] bg-white px-3 py-2 text-xs text-[#244f45]" onClick={() => onNote(note)}>{note}</button>)}</div></div>}
  </section>;
}
