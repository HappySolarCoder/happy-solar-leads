import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 5 * 60_000;
const cache: Record<string, { ts: number; data: any }> =
  (globalThis as any).__raydarHeatmapCache || ((globalThis as any).__raydarHeatmapCache = {});

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const TZ = 'America/New_York';

type DayKey = (typeof DAYS)[number];

type RepAgg = {
  repId: string;
  repName: string;
  appointments: number[][];
  activity: number[][];
  totalAppointments: number;
  totalKnocks: number;
};

function makeMatrix() {
  return DAYS.map(() => HOURS.map(() => 0));
}

function getDayHour(tsMs: number): { day: DayKey; hour: number } {
  const d = new Date(tsMs);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(d) as DayKey;
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: TZ }).format(d));
  return { day, hour };
}

function idxDay(day: DayKey) {
  return DAYS.indexOf(day);
}

function idxHour(hour: number) {
  return HOURS.indexOf(hour);
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isInternalStatus(raw: any) {
  const v = String(raw ?? '').trim().toLowerCase();
  return !v || v === 'unclaimed' || v === 'claimed';
}

function isAppointmentSet(raw: any) {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'appointment' || v === 'appointment set';
}

function ensureRep(reps: Record<string, RepAgg>, repId: string, repName: string): RepAgg {
  if (!reps[repId]) {
    reps[repId] = {
      repId,
      repName,
      appointments: makeMatrix(),
      activity: makeMatrix(),
      totalAppointments: 0,
      totalKnocks: 0,
    };
  }
  return reps[repId];
}

function addEvent(rep: RepAgg, team: RepAgg, tsMs: number, disposition: string) {
  const { day, hour } = getDayHour(tsMs);
  const di = idxDay(day);
  const hi = idxHour(hour);
  if (di < 0 || hi < 0) return;

  rep.activity[di][hi] += 1;
  rep.totalKnocks += 1;
  team.activity[di][hi] += 1;
  team.totalKnocks += 1;

  if (isAppointmentSet(disposition)) {
    rep.appointments[di][hi] += 1;
    rep.totalAppointments += 1;
    team.appointments[di][hi] += 1;
    team.totalAppointments += 1;
  }
}

function tzOffsetMs(tz: string, utcMs: number) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

function tzMidnightUtcMs(dateStr: string, tz: string) {
  // dateStr: YYYY-MM-DD interpreted as midnight in the provided time zone.
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr);
  if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  // Iterate to converge (DST-safe)
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMs(tz, guess);
    guess = Date.UTC(y, mo - 1, d, 0, 0, 0) - off;
  }
  return guess;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const start = url.searchParams.get('start'); // YYYY-MM-DD
  const end = url.searchParams.get('end'); // YYYY-MM-DD
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') || 14)));

  const cacheKey = start && end ? `start=${start}&end=${end}` : `days=${days}`;
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Heatmap-Cache': 'HIT',
      },
    });
  }

  try {
    const now = Date.now();

    let windowStartMs = now - days * 24 * 60 * 60_000;
    let windowEndExclusiveMs = now + 1;

    if (start && end) {
      const s = tzMidnightUtcMs(start, TZ);
      if (s == null) throw new Error('Invalid start (expected YYYY-MM-DD)');

      // end is inclusive; compute next-day midnight in the same TZ (DST-safe)
      const [ey, emo, ed] = end.split('-').map(Number);
      if (!ey || !emo || !ed) throw new Error('Invalid end (expected YYYY-MM-DD)');
      const endDate = new Date(Date.UTC(ey, emo - 1, ed, 12, 0, 0));
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const endPlusOneStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
      const e1 = tzMidnightUtcMs(endPlusOneStr, TZ);
      if (e1 == null) throw new Error('Invalid end (expected YYYY-MM-DD)');

      windowStartMs = s;
      windowEndExclusiveMs = e1;
    }

    const sinceMs = windowStartMs;
    const untilMs = windowEndExclusiveMs;

    const db = adminDb();

    // Map userId -> user.name so rep dropdown always shows human names when available.
    const usersSnap = (await Promise.race([
      db.collection('users').get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Heatmap users query timeout')), 5000)),
    ])) as any;
    const userNameById = new Map<string, string>();
    for (const u of usersSnap?.docs ?? []) {
      const ud: any = u.data();
      const id = String(u.id);
      const name = String(ud?.name ?? '').trim();
      if (name) userNameById.set(id, name);
    }

    const leadSnap = (await Promise.race([
      db.collection('leads').limit(10000).get(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Heatmap leads query timeout')), 8000)),
    ])) as any;

    const reps: Record<string, RepAgg> = {};
    const team: RepAgg = {
      repId: 'team',
      repName: 'Team',
      appointments: makeMatrix(),
      activity: makeMatrix(),
      totalAppointments: 0,
      totalKnocks: 0,
    };

    for (const doc of leadSnap.docs) {
      const lead: any = doc.data();
      const leadStatus = String(lead?.status ?? lead?.disposition ?? '').trim();

      const history: any[] = Array.isArray(lead?.dispositionHistory) ? lead.dispositionHistory : [];

      if (history.length > 0) {
        for (const entry of history) {
          const ts = parseDate(entry?.timestamp);
          if (!ts) continue;
          const tsMs = ts.getTime();
          if (tsMs < sinceMs || tsMs >= untilMs) continue;

          const entryDisposition = String(entry?.disposition ?? leadStatus ?? '').trim();
          if (isInternalStatus(entryDisposition)) continue;

          const repId = String(entry?.userId ?? lead?.claimedBy ?? lead?.setterId ?? 'unknown');
          const repName = String(entry?.userName ?? userNameById.get(repId) ?? repId);
          const rep = ensureRep(reps, repId, repName);

          addEvent(rep, team, tsMs, entryDisposition);
        }
        continue;
      }

      // Fallback for leads without dispositionHistory: use latest disposition event only.
      const fallbackTs = parseDate(lead?.dispositionedAt);
      if (!fallbackTs) continue;
      const tsMs = fallbackTs.getTime();
      if (tsMs < sinceMs || tsMs >= untilMs) continue;
      if (isInternalStatus(leadStatus)) continue;

      const repId = String(lead?.claimedBy ?? lead?.setterId ?? 'unknown');
      const repName = String(userNameById.get(repId) ?? repId);
      const rep = ensureRep(reps, repId, repName);
      addEvent(rep, team, tsMs, leadStatus);
    }

    const repList = Object.values(reps)
      .sort((a, b) => a.repName.localeCompare(b.repName))
      .map((r) => ({
        repId: r.repId,
        repName: r.repName,
        appointments: { hours: HOURS, days: DAYS, values: r.appointments },
        activity: { hours: HOURS, days: DAYS, values: r.activity },
        totals: { appointments: r.totalAppointments, knocks: r.totalKnocks },
      }));

    const windowDays = Math.max(1, Math.ceil((untilMs - sinceMs) / (24 * 60 * 60_000)));

    const payload = {
      ok: true,
      windowDays,
      windowStartMs: sinceMs,
      windowEndExclusiveMs: untilMs,
      timezone: TZ,
      appointmentDisposition: 'Appointment Set',
      team: {
        repId: team.repId,
        repName: team.repName,
        appointments: { hours: HOURS, days: DAYS, values: team.appointments },
        activity: { hours: HOURS, days: DAYS, values: team.activity },
        totals: { appointments: team.totalAppointments, knocks: team.totalKnocks },
      },
      reps: repList,
      note: 'v2.1 real data via leads.dispositionHistory; each non-internal disposition event counts as a knock.',
    };

    cache[cacheKey] = { ts: Date.now(), data: payload };

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'X-Heatmap-Cache': 'MISS',
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: 500 }
    );
  }
}
