import type { Lead } from "@/app/types";
import { calculateDistance } from "@/app/hooks/useGeolocation";
import { activityActor, dayStart } from "./metrics";

export type DoorSuggestion = {
  lead: Lead;
  distance: number;
  reason: string;
  priority: number;
};
const untouched = new Set([
  "",
  "assigned",
  "unassigned",
  "unclaimed",
  "claimed",
  "new",
  "not-knocked",
]);
export function suggestDoors(
  leads: Lead[],
  userId: string,
  position: [number, number] | undefined,
  now: Date
): DoorSuggestion[] {
  if (!position) return [];
  const today = dayStart(now).getTime();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).getTime();
  const candidates: DoorSuggestion[] = [];
  for (const lead of leads) {
    if (
      lead.historicalTerritoryPin ||
      (lead.assignedTo !== userId && lead.claimedBy !== userId)
    )
      continue;
    if (lead.claimedBy && lead.claimedBy !== userId) continue;
    if (
      ["customer", "sale"].includes(lead.leadType || "") ||
      !Number.isFinite(lead.lat) ||
      !Number.isFinite(lead.lng)
    )
      continue;
    const status = String(lead.status || "").toLowerCase();
    const outcome = String(lead.appointmentOutcome || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    if (
      ["sold", "won", "closedwon", "scheduled", "confirmed"].includes(outcome)
    )
      continue;
    const distance = calculateDistance(
      position[0],
      position[1],
      lead.lat!,
      lead.lng!
    );
    if (distance > 1) continue;
    const last = lead.dispositionedAt
      ? new Date(lead.dispositionedAt).getTime()
      : 0;
    // Explicit allowlist: never infer that a custom/negative status is safe to knock.
    let reason = "",
      priority = 10;
    if (status === "go-back") {
      const due = lead.goBackScheduledDate
        ? new Date(lead.goBackScheduledDate).getTime()
        : NaN;
      if (!Number.isFinite(due) || due >= tomorrow) continue;
      reason =
        due < today
          ? "Overdue go-back — check the agreed time"
          : "Go-back today — check the agreed time";
      priority = 0;
    } else if (status === "interested" && last < today) {
      reason = "Previously interested — a warm follow-up";
      priority = 1;
    } else if (untouched.has(status) && !last) {
      if (lead.solarCategory === "poor") continue;
      reason = ["great", "good"].includes(lead.solarCategory || "")
        ? `${
            lead.solarCategory === "great" ? "Great" : "Good"
          } solar roof · unworked door`
        : "Unworked door nearby";
      priority = ["great", "good"].includes(lead.solarCategory || "") ? 2 : 4;
    } else if (status === "not-home" && last > 0 && last < today) {
      reason = "Not home previously — try a different time";
      priority = 3;
    } else continue;
    candidates.push({ lead, distance, reason, priority });
  }
  return candidates
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
    .slice(0, 5);
}

export function sessionAppointments(
  leads: Lead[],
  userId: string,
  startedAt: string
): number {
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  return leads.filter((lead) => {
    if (lead.historicalTerritoryPin) return false;
    const recorded = lead.dispositionHistory?.some(
      (event) =>
        event.userId === userId &&
        ["appointment", "appointment set", "appt set"].includes(
          String(event.disposition).trim().toLowerCase()
        ) &&
        new Date(event.timestamp).getTime() >= start
    );
    if (recorded) return true;
    return (
      lead.status === "appointment" &&
      activityActor(lead) === userId &&
      !!lead.dispositionedAt &&
      new Date(lead.dispositionedAt).getTime() >= start
    );
  }).length;
}

/** Unique doors with a configured knock event by this rep during the session. */
export function sessionDoors(
  leads: Lead[],
  userId: string,
  startedAt: string,
  dispositions: import("@/app/types/disposition").Disposition[]
): number {
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return 0;
  const normalize = (value: string) => value.trim().toLowerCase();
  const knockStatuses = new Set(
    dispositions
      .filter((d) => d.countsAsDoorKnock)
      .flatMap((d) => [normalize(d.id), normalize(d.name)])
  );
  const ids = new Set<string>();
  for (const lead of leads) {
    if (lead.historicalTerritoryPin) continue;
    const recorded = lead.dispositionHistory?.some(
      (event) =>
        event.userId === userId &&
        knockStatuses.has(normalize(String(event.disposition))) &&
        new Date(event.timestamp).getTime() >= start
    );
    const legacy =
      !lead.dispositionHistory?.length &&
      activityActor(lead) === userId &&
      knockStatuses.has(normalize(lead.status || "")) &&
      lead.dispositionedAt &&
      new Date(lead.dispositionedAt).getTime() >= start;
    if (recorded || legacy) ids.add(lead.id);
  }
  return ids.size;
}
