import type { Lead, User } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";
import { getAppointmentOutcome } from "@/app/utils/appointmentOutcome";
import type {
  FieldConfig,
  FieldEvent,
  FieldFlags,
  SavingsAssumptions,
} from "./types";

const norm = (x: unknown) =>
  String(x || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function pilotFlags(
  config: FieldConfig,
  userId: string,
): { flags: FieldFlags; group: "pilot" | "control" } {
  let hash = 2166136261;
  for (const c of `${config.experiment}:${userId}`)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const inScope =
    !config.allowedUsers.length || config.allowedUsers.includes(userId);
  const pilot = inScope && (hash >>> 0) % 100 < config.pilotPercent;
  return {
    flags: Object.fromEntries(
      Object.entries(config.enabled).map(([k, v]) => [
        k,
        !!v && (k === "capture" ? inScope : pilot),
      ]),
    ) as FieldFlags,
    group: pilot ? "pilot" : "control",
  };
}
export function streetKey(lead: Lead) {
  const address = String(lead.address || '').replace(/^\s*\d+[a-z-]*\s+/i, '').trim().toLowerCase();
  if (!address) return `unknown:${lead.id}`;
  return `${address}|${String(lead.city || '').toLowerCase()}|${String(lead.state || '').toLowerCase()}|${lead.zip || ''}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function localParts(at: Date, timeZone: string) {
  try {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
        weekday: "short",
      });
      if (formatters.size >= 8) formatters.clear();
      formatters.set(timeZone, formatter);
    }
    const p = formatter.formatToParts(at);
    return {
      hour: Number(p.find((x) => x.type === "hour")?.value),
      day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        p.find((x) => x.type === "weekday")?.value || "",
      ),
    };
  } catch {
    return { hour: NaN, day: -1 };
  }
}
export function fieldEvents(
  leads: Lead[],
  dispositions: Disposition[],
  timeZone: string,
): FieldEvent[] {
  const mapping = new Map(
    dispositions.flatMap(
      (d) =>
        [
          [norm(d.id), d],
          [norm(d.name), d],
        ] as [string, Disposition][],
    ),
  );
  const result: FieldEvent[] = [];
  const seen = new Set<string>();
  for (const lead of leads) {
    if (lead.historicalTerritoryPin) continue;
    for (const h of lead.dispositionHistory || []) {
      const at = new Date(h.timestamp);
      if (!Number.isFinite(at.getTime())) continue;
      const f = h.field,
        d = mapping.get(norm(h.disposition));
      const id =
        f?.eventId ||
        `${lead.id}:${h.userId}:${at.toISOString()}:${h.disposition}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const parts =
        f &&
        Number.isInteger(f.localHour) &&
        f.localHour >= 0 &&
        f.localHour < 24 &&
        Number.isInteger(f.localDay) &&
        f.localDay >= 0 &&
        f.localDay <= 6
          ? { hour: f.localHour, day: f.localDay }
          : localParts(at, f?.timeZone || timeZone);
      // Only explicit observations enter contact/engagement denominators.
      result.push({
        id,
        leadId: lead.id,
        repId: h.userId,
        at,
        street: streetKey(lead),
        territoryId: f?.territoryId || "",
        statusId: f?.statusId || d?.id || h.disposition,
        knock: f?.countsAsKnock ?? !!d?.countsAsDoorKnock,
        answered: f?.answered,
        engaged: f?.conversation ? f.conversation === "45s-plus" : undefined,
        openerId: f?.openerId,
        previewShown: f?.previewShown,
        proofShown: f?.proofShown,
        localHour: parts.hour,
        localDay: parts.day,
        group: f?.group || "legacy",
        experiment: f?.experiment || "legacy",
      });
    }
  }
  return result;
}
export function excludedDoor(lead: Lead): string | null {
  if (lead.historicalTerritoryPin) return "Historical pin";
  if (
    lead.fieldDoor?.doNotKnock ||
    ["donotknock", "donotcontact", "dnc", "dnk"].includes(norm(lead.status))
  )
    return "Do not knock";
  if (
    lead.fieldDoor?.hasSolar ||
    lead.objectionType === "already-has-solar" ||
    ["customer", "sale"].includes(lead.leadType || "")
  )
    return "Existing solar/customer";
  if (
    (lead.fieldDoor?.ownerVerified && lead.fieldDoor.ownerOccupied === false) ||
    ["renter", "tenant"].includes(norm(lead.status)) ||
    lead.objectionType === "not-owner"
  )
    return "Recorded non-owner";
  if (
    [
      "appointment",
      "sale",
      "sold",
      "notinterested",
      "dqcredit",
      "shadedq",
      "disqualified",
    ].includes(norm(lead.status))
  )
    return "Already worked / excluded";
  if (
    ["scheduled", "sold", "show"].includes(
      getAppointmentOutcome(lead)?.key || "",
    )
  )
    return "Appointment/customer";
  return null;
}
export function accessibleDoor(lead: Lead, user: Pick<User, "id" | "role">) {
  return (
    !lead.historicalTerritoryPin &&
    (user.role === "admin" ||
      user.role === "manager" ||
      (lead.claimedBy
        ? lead.claimedBy === user.id
        : lead.assignedTo === user.id))
  );
}
export type EventIndex = {
  byStreet: Map<string, FieldEvent[]>;
  byDoor: Map<string, FieldEvent[]>;
  knocks: FieldEvent[];
};
export function indexEvents(events: FieldEvent[]): EventIndex {
  const byStreet = new Map<string, FieldEvent[]>(),
    byDoor = new Map<string, FieldEvent[]>(),
    knocks: FieldEvent[] = [];
  for (const e of events) {
    for (const [map, key] of [
      [byStreet, e.street],
      [byDoor, e.leadId],
    ] as const) {
      const a = map.get(key) || [];
      a.push(e);
      map.set(key, a);
    }
    if (e.knock) knocks.push(e);
  }
  return { byStreet, byDoor, knocks };
}
export function scoreDoor(lead: Lead) {
  const excluded = excludedDoor(lead);
  if (excluded)
    return { score: 0, reasons: [excluded], excluded: true, known: 0 };
  let score = 0,
    known = 0;
  const reasons: string[] = [];
  const quality = { poor: 10, solid: 35, good: 55, great: 70 };
  if (lead.solarCategory && Object.hasOwn(quality, lead.solarCategory)) {
    score += quality[lead.solarCategory];
    known++;
    reasons.push(`${lead.solarCategory} recorded solar fit`);
  }
  if (lead.hasSouthFacingRoof === true) {
    score += 10;
    known++;
    reasons.push("South-facing roof recorded");
  }
  if (lead.fieldDoor?.ownerOccupied === true && lead.fieldDoor.ownerVerified) {
    score += 10;
    known++;
    reasons.push("Owner occupancy verified");
  }
  if (lead.solarMaxPanels && lead.solarMaxPanels >= 12) {
    score += 10;
    known++;
    reasons.push("Recorded roof capacity: 12+ panels");
  }
  if (!known) reasons.push("Solar/property data not yet available");
  return {
    score: Math.min(100, score),
    reasons: reasons.slice(0, 3),
    excluded: false,
    known,
  };
}
export type ContactWindow = {
  start: number;
  end: number;
  answers: number;
  attempts: number;
  confidence: "observed" | "insufficient";
};
export function contactWindows(
  lead: Lead,
  events: FieldEvent[] | EventIndex,
  config: FieldConfig,
  now: Date,
  timeZone: string,
): ContactWindow[] {
  const today = localParts(now, timeZone);
  const weekend = today.day === 0 || today.day === 6;
  const source = Array.isArray(events)
    ? events
    : events.byStreet.get(streetKey(lead)) || [];
  const scoped = source.filter(
    (e) =>
      e.street === streetKey(lead) &&
      e.knock &&
      e.answered !== undefined &&
      (e.localDay === 0 || e.localDay === 6) === weekend &&
      e.at <= now &&
      now.getTime() - e.at.getTime() < 90 * 86400000,
  );
  const out: ContactWindow[] = [];
  for (let start = config.startHour; start < config.endHour; start += 2) {
    const end = Math.min(start + 2, config.endHour),
      es = scoped.filter((e) => e.localHour >= start && e.localHour < end);
    const days = new Set(es.map((e) => e.at.toISOString().slice(0, 10))).size;
    out.push({
      start,
      end,
      answers: es.filter((e) => e.answered).length,
      attempts: es.length,
      confidence:
        es.length >= config.minTimingAttempts && days >= 3
          ? "observed"
          : "insufficient",
    });
  }
  return out.sort(
    (a, b) =>
      (b.answers + 2) / (b.attempts + 4) - (a.answers + 2) / (a.attempts + 4),
  );
}
export function revisitDoors(
  leads: Lead[],
  events: FieldEvent[],
  config: FieldConfig,
  user: Pick<User, "id" | "role">,
  now: Date,
  timeZone: string,
) {
  const index = indexEvents(events),
    windows = new Map<string, ContactWindow | undefined>();
  const hour = localParts(now, timeZone).hour;
  if (
    !Number.isFinite(hour) ||
    hour < config.startHour ||
    hour >= config.endHour
  )
    return [];
  return leads
    .filter(
      (l) =>
        accessibleDoor(l, user) &&
        !excludedDoor(l) &&
        ["nothome", "noansweroccupied"].includes(norm(l.status)),
    )
    .flatMap((lead) => {
      const attempts = (index.byDoor.get(lead.id) || [])
        .filter((e) => e.knock)
        .sort((a, b) => b.at.getTime() - a.at.getTime());
      if (!attempts.length || attempts.length >= config.maxAttempts) return [];
      const last = attempts[0];
      if (now.getTime() - last.at.getTime() < 24 * 3600000) return [];
      if (
        attempts.some(
          (e) =>
            Math.floor((e.localHour - config.startHour) / 2) ===
            Math.floor((hour - config.startHour) / 2),
        )
      )
        return [];
      const street = streetKey(lead);
      if (!windows.has(street))
        windows.set(
          street,
          contactWindows(lead, index, config, now, timeZone).find(
            (w) => w.confidence === "observed",
          ),
        );
      const best = windows.get(street);
      if (best && (hour < best.start || hour >= best.end)) return [];
      return [
        {
          lead,
          attempts: attempts.length,
          best,
          reason: best
            ? `${best.answers}/${best.attempts} observed answers on this street in this window`
            : "Try a different window; not enough street evidence yet",
          score: scoreDoor(lead).score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}
export function funnel(events: FieldEvent[], leads: Lead[], now: Date) {
  const knocks = events.filter((e) => e.knock),
    contacts = knocks.filter((e) => e.answered !== undefined),
    answered = contacts.filter((e) => e.answered),
    engagement = answered.filter((e) => e.engaged !== undefined);
  const appointmentEvents = knocks.filter(
    (e) => norm(e.statusId) === "appointment",
  );
  const sets = new Set(appointmentEvents.map((e) => e.leadId));
  const mature = leads.filter(
    (l) =>
      sets.has(l.id) &&
      l.appointmentDateTime &&
      new Date(l.appointmentDateTime).getTime() < now.getTime() - 86400000,
  );
  const terminal = mature.filter((l) =>
    ["show", "sold", "noshow", "cancelled"].includes(
      getAppointmentOutcome(l)?.key || "",
    ),
  );
  const shown = terminal.filter((l) =>
    ["show", "sold"].includes(getAppointmentOutcome(l)?.key || ""),
  );
  return {
    knocks: knocks.length,
    contactKnown: contacts.length,
    answered: answered.length,
    engagementKnown: engagement.length,
    engaged: engagement.filter((e) => e.engaged).length,
    sets: sets.size,
    mature: mature.length,
    resolved: terminal.length,
    shown: shown.length,
    unknownContact: knocks.length - contacts.length,
    unknownOutcome: mature.length - terminal.length,
  };
}
export function dailyTip(
  events: FieldEvent[],
  leads: Lead[],
  now: Date,
): string {
  const f = funnel(events, leads, now);
  if (f.contactKnown < 20)
    return "Keep recording whether someone answered. Timing guidance needs more observed knocks.";
  if (f.answered / f.contactKnown < 0.25)
    return "Few recorded knocks reached someone. Try a spaced return sweep in a different time window.";
  if (f.engagementKnown >= 15 && f.engaged / f.engagementKnown < 0.3)
    return "Most measured conversations were short. Ask your manager to review the opening of your approved script.";
  if (f.resolved >= 10 && f.shown / f.resolved < 0.6)
    return "Review recent no-shows with your scheduling manager and compare the handoff notes.";
  if (f.answered >= 20 && f.sets / f.answered < 0.15)
    return "Review a few interested conversations with your manager and practice the transition to the scheduling call.";
  return "Keep your scheduled go-backs and complete any unresolved scheduling-manager handoffs.";
}
export function savingsPreview(lead: Lead, a: SavingsAssumptions | null) {
  if (
    !a?.approved ||
    !a.source ||
    !a.approvedAt ||
    Date.now() - Date.parse(a.approvedAt) > 180 * 86400000 ||
    Date.parse(a.approvedAt) > Date.now() + 86400000 ||
    a.state.toUpperCase() !== lead.state.toUpperCase() ||
    !lead.estimatedBill ||
    !lead.solarMaxPanels
  )
    return null;
  const kw = (lead.solarMaxPanels * a.panelWatts) / 1000;
  const bill = Math.max(0, lead.estimatedBill - a.fixedMonthlyCharge);
  const production = [
    (kw * a.annualKwhPerKwLow) / 12,
    (kw * a.annualKwhPerKwHigh) / 12,
  ];
  const value = production.map((kwh, i) =>
    Math.min(
      bill,
      kwh * a.selfConsumption * (i ? a.avoidedRateHigh : a.avoidedRateLow) +
        kwh * (1 - a.selfConsumption) * a.exportRate,
    ),
  );
  const payments = [
    kw * a.monthlyPaymentPerKwLow,
    kw * a.monthlyPaymentPerKwHigh,
  ];
  return {
    kw,
    production,
    payments,
    savings: [value[0] - payments[1], value[1] - payments[0]],
    bill: lead.estimatedBill,
    source: a.source,
    approvedAt: a.approvedAt,
  };
}
