import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';

export const dynamic = 'force-dynamic';

const TZ_DEFAULT = 'America/New_York';

const ATTEMPT_STATUS_IDS = new Set([
  'not-home',
  'interested',
  'not-interested',
  'appointment',
  'go-back',
  'sale',
  'dq-credit',
  'shade-dq',
  'follow-up-later',
  'renter',
]);
const INTERNAL_STATUS_IDS = new Set(['unclaimed', 'claimed', '', 'unknown', 'null', 'undefined']);

const LABEL_TO_ID: Record<string, string> = {
  'not home': 'not-home',
  'interested': 'interested',
  'not interested': 'not-interested',
  'appointment set': 'appointment',
  'appointment': 'appointment',
  'sale!': 'sale',
  'sale': 'sale',
  'go back': 'go-back',
  'dq credit': 'dq-credit',
  'shade dq': 'shade-dq',
  'callback scheduled': 'follow-up-later',
  'follow up later': 'follow-up-later',
  'follow-up-later': 'follow-up-later',
  'renter': 'renter',
};

function norm(s: any) {
  return String(s ?? '').trim().toLowerCase();
}

function classifyFromLabel(label: any): string | null {
  const k = norm(label);
  if (!k) return null;
  if (ATTEMPT_STATUS_IDS.has(k) || INTERNAL_STATUS_IDS.has(k)) return k;
  return LABEL_TO_ID[k] || null;
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdInTz(utcMs: number, tz: string) {
  const d = new Date(utcMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function hourInTz(utcMs: number, tz: string) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      hour12: false,
    }).format(new Date(utcMs))
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repId = url.searchParams.get('repId') || 'team';
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') || 14)));
  const tz = url.searchParams.get('tz') || TZ_DEFAULT;

  const now = Date.now();
  const windowStartMs = now - days * 24 * 60 * 60_000;
  const windowEndExclusiveMs = now + 1;

  try {
    const db = adminDb();

    const usersSnap = await db.collection('users').get();
    const userNameById = new Map<string, string>();
    for (const u of usersSnap?.docs ?? []) {
      const ud: any = u.data();
      const id = String(u.id);
      const name = String(ud?.name ?? '').trim();
      if (name) userNameById.set(id, name);
    }

    const leadSnap = await db.collection('leads').limit(10000).get();

    type DayAgg = {
      attempts: number;
      appointments: number;
      moderate: number;
      notInterested: number;
      primeAttempts: number;
    };

    const byDay: Record<string, DayAgg> = {};
    const ensure = (d: string): DayAgg =>
      (byDay[d] ||= { attempts: 0, appointments: 0, moderate: 0, notInterested: 0, primeAttempts: 0 });

    const PRIME_START = 16;
    const PRIME_END = 19;

    const processEvent = (uid: string, dispositionLabel: string, dt: Date) => {
      const tsMs = dt.getTime();
      if (tsMs < windowStartMs || tsMs >= windowEndExclusiveMs) return;

      const mapped = classifyFromLabel(dispositionLabel);
      if (!mapped) return;
      if (INTERNAL_STATUS_IDS.has(mapped)) return;
      if (!ATTEMPT_STATUS_IDS.has(mapped)) return;

      if (repId !== 'team' && uid !== repId) return;

      const day = ymdInTz(tsMs, tz);
      const agg = ensure(day);

      agg.attempts += 1;
      if (mapped === 'appointment') agg.appointments += 1;
      if (mapped === 'go-back' || mapped === 'interested') agg.moderate += 1;
      if (mapped === 'not-interested') agg.notInterested += 1;

      const hr = hourInTz(tsMs, tz);
      if (hr >= PRIME_START && hr <= PRIME_END) agg.primeAttempts += 1;
    };

    for (const doc of leadSnap.docs) {
      const lead: any = doc.data();
      const history: any[] = Array.isArray(lead?.dispositionHistory) ? lead.dispositionHistory : [];

      if (history.length === 0) {
        const dt = parseDate(lead?.dispositionedAt);
        if (!dt) continue;
        const uid = String(lead?.claimedBy ?? lead?.setterId ?? 'unknown');
        const statusId = norm(lead?.status);
        processEvent(uid, statusId, dt);
        continue;
      }

      for (const entry of history) {
        const dt = parseDate(entry?.timestamp);
        if (!dt) continue;
        const uid = String(entry?.userId ?? lead?.claimedBy ?? lead?.setterId ?? 'unknown');
        const dispoLabel = String(entry?.disposition ?? lead?.status ?? '');
        processEvent(uid, dispoLabel, dt);
      }
    }

    const daysSorted = Object.keys(byDay).sort();

    const series = daysSorted.map((day) => {
      const d = byDay[day];
      const appointmentRate = d.attempts > 0 ? +(d.appointments / d.attempts * 100).toFixed(2) : 0;
      const moderateRate = d.attempts > 0 ? +(d.moderate / d.attempts * 100).toFixed(2) : 0;
      const notInterestedRate = d.attempts > 0 ? +(d.notInterested / d.attempts * 100).toFixed(2) : 0;
      const primeShare = d.attempts > 0 ? +(d.primeAttempts / d.attempts * 100).toFixed(2) : 0;
      return {
        day,
        attempts: d.attempts,
        appointments: d.appointments,
        appointmentRatePct: appointmentRate,
        moderate: d.moderate,
        moderateSuccessRatePct: moderateRate,
        notInterested: d.notInterested,
        notInterestedRatePct: notInterestedRate,
        primeSharePct: primeShare,
      };
    });

    const repName = repId === 'team' ? 'Team' : (userNameById.get(repId) ?? repId);

    return NextResponse.json({
      ok: true,
      rep: { repId, repName },
      timezone: tz,
      windowDays: days,
      series,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
