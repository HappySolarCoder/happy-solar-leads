import type { Lead } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";
import {
  countKnocks,
  type KnockCountOptions,
  type KnockEvent,
} from "@/app/utils/knockCount";

// Latest actor is still used for appointments and sales. Knocks use visit history.
export function activityActor(lead: Lead): string | undefined {
  return (
    lead.dispositionHistory?.[0]?.userId || lead.claimedBy || lead.assignedTo
  );
}

export type ActivityCountOptions = {
  ledger?: readonly KnockEvent[];
  /** Snapshots and hot leads. Knocks union these; appointments stay on `leads`. */
  knockSources?: readonly Lead[];
  leadAliases?: KnockCountOptions["leadAliases"];
};

export function summarizeActivity(
  leads: Lead[],
  userId: string,
  dispositions: Disposition[],
  from: Date,
  until: Date,
  options?: ActivityCountOptions,
) {
  const result = {
    knocks: countKnocks(options?.knockSources ?? leads, dispositions, {
      userId,
      start: from,
      end: until,
      ledger: options?.ledger,
      leadAliases: options?.leadAliases,
    }),
    conversations: 0,
    appointments: 0,
    sales: 0,
  };
  for (const lead of leads) {
    if (activityActor(lead) !== userId || !lead.dispositionedAt) continue;
    const time = new Date(lead.dispositionedAt).getTime();
    if (
      !Number.isFinite(time) ||
      time < from.getTime() ||
      time >= until.getTime()
    )
      continue;
    const status = String(lead.status || lead.disposition || "").toLowerCase();
    // Appointments and sales still follow the latest status. That is unchanged.
    if (["interested", "appointment", "sale"].includes(status))
      result.conversations++;
    if (["appointment", "sale"].includes(status)) result.appointments++;
    if (status === "sale") result.sales++;
  }
  return result;
}

export function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function followUpBucket(
  lead: Lead,
  now: Date,
): "overdue" | "today" | "upcoming" | "unscheduled" {
  if (!lead.goBackScheduledDate) return "unscheduled";
  const date = new Date(lead.goBackScheduledDate);
  if (!Number.isFinite(date.getTime())) return "unscheduled";
  const start = dayStart(now);
  const end = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 1,
  );
  if (date < start) return "overdue";
  return date < end ? "today" : "upcoming";
}
