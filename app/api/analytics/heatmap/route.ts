import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebaseAdmin';

type HeatmapGrid = {
  hours: number[];
  days: string[];
  values: number[][]; // [dayIndex][hourIndex]
};

type RepRow = {
  repId: string;
  repName: string;
  appointments: HeatmapGrid;
  activity: HeatmapGrid;
  totals: { appointments: number; knocks: number };
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function getHourAndDowInTZ(date: Date, timeZone: string): { hour: number; dow: (typeof DAYS)[number] } {
  // Use Intl to avoid bringing in heavy TZ deps
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const hourStr = parts.find(p => p.type === 'hour')?.value ?? '0';
  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Mon';

  // Intl weekday short gives Mon/Tue/... in English; map defensively
  const dow = (DAYS as readonly string[]).includes(weekday) ? (weekday as any) : 'Mon';
  return { hour: Number(hourStr), dow };
}

function emptyGrid(hours: number[]): HeatmapGrid {
  return {
    hours,
    days: [...DAYS],
    values: DAYS.map(() => hours.map(() => 0)),
  };
}

function isAppointmentDisposition(d: string | undefined | null): boolean {
  if (!d) return false;
  const s = String(d).toLowerCase();
  return s === 'appointment set' || s === 'appointment' || s.includes('appointment');
}

function getEntryDate(entry: any): Date | null {
  const raw = entry?.createdAt ?? entry?.timestamp ?? entry?.dispositionedAt ?? entry?.ts;
  if (!raw) return null;
  if (raw.toDate) return raw.toDate(); // Firestore Timestamp
  if (raw instanceof Date) return raw;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const days = Math.min(Math.max(Number(url.searchParams.get('days') || '14'), 1), 60);
  const timeZone = url.searchParams.get('tz') || 'America/New_York';

  // Default to business hours; UI can change later.
  const startHour = Number(url.searchParams.get('startHour') || '9');
  const endHour = Number(url.searchParams.get('endHour') || '19');
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const appointmentDisposition = url.searchParams.get('appointmentDisposition') || 'Appointment Set';

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const db = adminDb();

    // Heuristic: pull leads that have been dispositioned recently. This is the best available filter
    // without a dedicated per-knock event collection.
    const leadsSnap = await db
      .collection('leads')
      .where('dispositionedAt', '>=', since)
      .get();

    const byRep = new Map<string, RepRow>();

    function getOrCreateRep(repId: string, repName: string): RepRow {
      const k = repId || repName || 'unknown';
      const existing = byRep.get(k);
      if (existing) return existing;
      const row: RepRow = {
        repId: repId || k,
        repName: repName || repId || 'Unknown',
        appointments: emptyGrid(hours),
        activity: emptyGrid(hours),
        totals: { appointments: 0, knocks: 0 },
      };
      byRep.set(k, row);
      return row;
    }

    // Team aggregate uses repId = team
    const team = getOrCreateRep('team', 'Team');

    for (const doc of leadsSnap.docs) {
      const lead = doc.data() as any;
      const history: any[] = Array.isArray(lead.dispositionHistory) ? lead.dispositionHistory : [];

      for (const entry of history) {
        const dt = getEntryDate(entry);
        if (!dt || dt < since) continue;

        // "each non-internal disposition event counts as a knock" (best-effort)
        const disposition = entry?.disposition ?? entry?.newDisposition ?? entry?.status ?? lead.status;
        if (!disposition) continue;

        const repId = entry?.userId || entry?.setterId || entry?.user || 'unknown';
        const repName = entry?.userName || entry?.setterName || entry?.userDisplayName || 'Unknown';

        const { hour, dow } = getHourAndDowInTZ(dt, timeZone);
        if (hour < startHour || hour > endHour) continue;

        const dayIdx = DAYS.indexOf(dow as any);
        const hourIdx = hours.indexOf(hour);
        if (dayIdx < 0 || hourIdx < 0) continue;

        // Count activity/knocks
        const rep = getOrCreateRep(repId, repName);
        rep.activity.values[dayIdx][hourIdx] += 1;
        rep.totals.knocks += 1;
        team.activity.values[dayIdx][hourIdx] += 1;
        team.totals.knocks += 1;

        // Count appointments
        if (isAppointmentDisposition(disposition) || String(disposition) === appointmentDisposition) {
          rep.appointments.values[dayIdx][hourIdx] += 1;
          rep.totals.appointments += 1;
          team.appointments.values[dayIdx][hourIdx] += 1;
          team.totals.appointments += 1;
        }
      }
    }

    // Return a stable array sorted: team first, then reps by name
    const reps = Array.from(byRep.values()).sort((a, b) => {
      if (a.repId === 'team') return -1;
      if (b.repId === 'team') return 1;
      return a.repName.localeCompare(b.repName);
    });

    return NextResponse.json({
      ok: true,
      windowDays: days,
      timeZone,
      appointmentDisposition,
      reps,
      note: 'v2.1 real data via leads.dispositionHistory; each dispositionHistory entry counts as a knock (best-effort).',
    });
  } catch (error: any) {
    console.error('[heatmap] error', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
