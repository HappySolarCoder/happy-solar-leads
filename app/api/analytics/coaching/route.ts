import { NextResponse } from 'next/server';
import { adminDb } from '@/app/utils/firebase-admin';
import { OBJECTION_LABELS } from '@/app/types';

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
  // core
  'not home': 'not-home',
  'interested': 'interested',
  'not interested': 'not-interested',
  'appointment set': 'appointment',
  'appointment': 'appointment',
  'sale!': 'sale',
  'sale': 'sale',
  'go back': 'go-back',
  // extras
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
  // if it already looks like an id, accept
  if (ATTEMPT_STATUS_IDS.has(k) || INTERNAL_STATUS_IDS.has(k)) return k;
  return LABEL_TO_ID[k] || null;
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
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr);
  if (!m) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  let guess = Date.UTC(y, mo - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMs(tz, guess);
    guess = Date.UTC(y, mo - 1, d, 0, 0, 0) - off;
  }
  return guess;
}

function parseDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function redactPII(raw: any) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  // emails
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  // phone numbers (naive but effective)
  s = s.replace(/\+?1?\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g, '[REDACTED_PHONE]');
  // addresses: redact common street number + name patterns
  s = s.replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Cir|Circle|Way)\b/gi, '[REDACTED_ADDRESS]');
  return s;
}

function pct(num: number, den: number) {
  return den > 0 ? +(num / den * 100).toFixed(2) : 0;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const repId = url.searchParams.get('repId') || 'team';
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') || 14)));
  const tz = url.searchParams.get('tz') || TZ_DEFAULT;

  // Optional: start/end override (YYYY-MM-DD)
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  const now = Date.now();
  let windowStartMs = now - days * 24 * 60 * 60_000;
  let windowEndExclusiveMs = now + 1;

  if (start && end) {
    const s = tzMidnightUtcMs(start, tz);
    if (s == null) return NextResponse.json({ ok: false, error: 'Invalid start (expected YYYY-MM-DD)' }, { status: 400 });

    const [ey, emo, ed] = end.split('-').map(Number);
    if (!ey || !emo || !ed) return NextResponse.json({ ok: false, error: 'Invalid end (expected YYYY-MM-DD)' }, { status: 400 });
    const endDate = new Date(Date.UTC(ey, emo - 1, ed, 12, 0, 0));
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endPlusOneStr = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
    const e1 = tzMidnightUtcMs(endPlusOneStr, tz);
    if (e1 == null) return NextResponse.json({ ok: false, error: 'Invalid end (expected YYYY-MM-DD)' }, { status: 400 });

    windowStartMs = s;
    windowEndExclusiveMs = e1;
  }

  try {
    const db = adminDb();

    // userId -> name mapping for consistent rep names
    const usersSnap = await db.collection('users').get();
    const userNameById = new Map<string, string>();
    for (const u of usersSnap?.docs ?? []) {
      const ud: any = u.data();
      const id = String(u.id);
      const name = String(ud?.name ?? '').trim();
      if (name) userNameById.set(id, name);
    }

    const leadSnap = await db.collection('leads').limit(10000).get();

    // Aggregate
    let attempts = 0;
    let success = 0; // appointment
    let moderate = 0; // interested + go-back

    const byStatus: Record<string, number> = {};
    const notInterestedReasons: Record<string, number> = {};

    const objectionSamples: Array<{ ts: string; type: string; label: string; notes: string }> = [];
    const noteSamples: Array<{ ts: string; notes: string }> = [];

    // Timing (prime time)
    const primeStartHour = 16; // 4pm
    const primeEndHour = 19; // through 7pm
    let primeAttempts = 0;

    const getHourTz = (utcMs: number) => {
      const hour = Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(utcMs)));
      return hour;
    };

    const considerSample = (arr: any[], item: any, cap: number) => {
      if (arr.length >= cap) return;
      arr.push(item);
    };

    for (const doc of leadSnap.docs) {
      const lead: any = doc.data();

      // Rep filtering (team = include all)
      const leadRepId = String(lead?.claimedBy ?? lead?.setterId ?? '');
      if (repId !== 'team' && leadRepId !== repId) {
        // still allow events where history entry userId matches repId
        // handled below per entry
      }

      const history: any[] = Array.isArray(lead?.dispositionHistory) ? lead.dispositionHistory : [];
      // If we don't have history, use dispositionedAt + status as a single event
      const fallbackEvent = history.length === 0;

      const processEvent = (ev: any, evUserId: string, evUserName: string, evDispositionLabel: string, evTs: Date) => {
        const tsMs = evTs.getTime();
        if (tsMs < windowStartMs || tsMs >= windowEndExclusiveMs) return;

        const mapped = classifyFromLabel(evDispositionLabel);
        if (!mapped) return;
        if (INTERNAL_STATUS_IDS.has(mapped)) return;
        if (!ATTEMPT_STATUS_IDS.has(mapped)) return;

        // Rep filter: team includes all; else only include if event belongs to rep
        if (repId !== 'team' && evUserId !== repId) return;

        attempts++;
        byStatus[mapped] = (byStatus[mapped] || 0) + 1;

        const hr = getHourTz(tsMs);
        if (hr >= primeStartHour && hr <= primeEndHour) primeAttempts++;

        if (mapped === 'appointment') success++;
        if (mapped === 'go-back' || mapped === 'interested') moderate++;

        // Not interested reason breakdown from lead.objectionType
        if (mapped === 'not-interested') {
          const ot = norm(lead?.objectionType);
          if (ot) {
            notInterestedReasons[ot] = (notInterestedReasons[ot] || 0) + 1;
          }
        }

        // Samples
        const iso = evTs.toISOString();

        if (mapped === 'not-interested') {
          const ot = norm(lead?.objectionType);
          const notes = redactPII(lead?.objectionNotes);
          if (ot || notes) {
            const label = (OBJECTION_LABELS as any)?.[ot] || ot || 'Not Interested';
            considerSample(objectionSamples, { ts: iso, type: ot || 'not-interested', label, notes }, 20);
          }
        }

        const leadNotes = redactPII(lead?.notes);
        if (leadNotes) {
          considerSample(noteSamples, { ts: iso, notes: leadNotes }, 20);
        }
      };

      if (fallbackEvent) {
        const dt = parseDate(lead?.dispositionedAt);
        const statusId = norm(lead?.status);
        if (!dt) continue;
        const uid = String(lead?.claimedBy ?? lead?.setterId ?? 'unknown');
        const uname = String(userNameById.get(uid) ?? uid);
        // use status id as label mapping input
        processEvent(null, uid, uname, statusId, dt);
        continue;
      }

      for (const entry of history) {
        const dt = parseDate(entry?.timestamp);
        if (!dt) continue;
        const uid = String(entry?.userId ?? lead?.claimedBy ?? lead?.setterId ?? 'unknown');
        const uname = String(entry?.userName ?? userNameById.get(uid) ?? uid);
        const dispoLabel = String(entry?.disposition ?? lead?.status ?? '');
        processEvent(entry, uid, uname, dispoLabel, dt);
      }
    }

    // Sort samples newest-first
    objectionSamples.sort((a, b) => b.ts.localeCompare(a.ts));
    noteSamples.sort((a, b) => b.ts.localeCompare(a.ts));

    const repName = repId === 'team' ? 'Team' : (userNameById.get(repId) ?? repId);

    const payload = {
      ok: true,
      rep: { repId, repName },
      timezone: tz,
      windowStartMs,
      windowEndExclusiveMs,
      totals: {
        attempts,
        successAppointments: success,
        moderateSuccess: moderate,
        appointmentRatePct: pct(success, attempts),
        moderateSuccessRatePct: pct(moderate, attempts),
        primeAttempts,
        primeSharePct: pct(primeAttempts, attempts),
      },
      breakdown: {
        byStatus,
        notInterestedReasons: Object.fromEntries(
          Object.entries(notInterestedReasons)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => [k, { count: v, label: (OBJECTION_LABELS as any)?.[k] || k }])
        ),
      },
      samples: {
        objections: objectionSamples.slice(0, 20),
        notes: noteSamples.slice(0, 20),
      },
      definitions: {
        attemptStatusIds: Array.from(ATTEMPT_STATUS_IDS),
        successStatusId: 'appointment',
        moderateSuccessStatusIds: ['go-back', 'interested'],
        notInterestedSubDispositionField: 'objectionType',
      },
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
