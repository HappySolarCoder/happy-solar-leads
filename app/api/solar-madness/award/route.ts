import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import type { SolarMadnessConfig, SolarMadnessPrize, SolarMadnessTriggerType } from '@/app/types/solarMadness';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function isWithinSeason(cfg: SolarMadnessConfig, now: Date) {
  const start = cfg?.startsAt?.toDate ? cfg.startsAt.toDate() : new Date(cfg?.startsAt);
  const end = cfg?.endsAt?.toDate ? cfg.endsAt.toDate() : new Date(cfg?.endsAt);
  return start instanceof Date && !isNaN(start.getTime()) && end instanceof Date && !isNaN(end.getTime())
    ? now >= start && now <= end
    : false;
}

function pickWeighted(prizes: SolarMadnessPrize[]): SolarMadnessPrize | null {
  const enabled = prizes.filter(p => p?.enabled && Number(p?.weight) > 0);
  if (enabled.length === 0) return null;
  const total = enabled.reduce((s, p) => s + Number(p.weight), 0);
  let r = Math.random() * total;
  for (const p of enabled) {
    r -= Number(p.weight);
    if (r <= 0) return p;
  }
  return enabled[enabled.length - 1];
}

function isAppointmentDisposition(dispositionName?: string) {
  const n = String(dispositionName || '').toLowerCase();
  return n.includes('appointment');
}

function sha1(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await adminAuth().verifyIdToken(idToken);

    const body = await request.json();
    const leadId = String(body?.leadId || '');
    const dispositionId = body?.dispositionId ? String(body.dispositionId) : undefined;
    const dispositionName = body?.dispositionName ? String(body.dispositionName) : undefined;

    if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });

    const cfgDoc = await adminDb().collection('solarMadnessConfig').doc('current').get();
    if (!cfgDoc.exists) {
      return NextResponse.json({ awarded: false, reason: 'no-config' });
    }

    const cfg = cfgDoc.data() as SolarMadnessConfig;
    if (!cfg?.enabled) {
      return NextResponse.json({ awarded: false, reason: 'disabled' });
    }

    const now = new Date();
    if (!isWithinSeason(cfg, now)) {
      return NextResponse.json({ awarded: false, reason: 'out-of-season' });
    }

    const triggerType: SolarMadnessTriggerType = isAppointmentDisposition(dispositionName) ? 'appointment' : 'regular';
    const oddsUsed = clamp01(triggerType === 'appointment' ? Number(cfg.baseOddsAppointment) : Number(cfg.baseOddsRegular));

    // Idempotency: one award per uid+lead+trigger+disposition+day
    const day = now.toISOString().slice(0, 10);
    const idempotencyKey = sha1(`${decoded.uid}|${leadId}|${triggerType}|${dispositionName || ''}|${day}`);

    const eventRef = adminDb().collection('solarMadnessEvents').doc(idempotencyKey);
    const existing = await eventRef.get();
    if (existing.exists) {
      const totalDoc = await adminDb().collection('solarMadnessTotals').doc(decoded.uid).get();
      const totalPoints = totalDoc.exists ? Number((totalDoc.data() as any)?.points || 0) : 0;
      return NextResponse.json({
        awarded: true,
        reason: 'idempotent',
        seasonName: cfg.seasonName,
        eventId: idempotencyKey,
        totalPoints,
      });
    }

    const hit = Math.random() < oddsUsed;
    if (!hit) {
      return NextResponse.json({ awarded: false, reason: 'miss', seasonName: cfg.seasonName, triggerType, oddsUsed });
    }

    const pool = triggerType === 'appointment' ? (cfg.appointmentPrizes || []) : (cfg.regularPrizes || []);
    const prize = pickWeighted(pool);
    if (!prize) {
      return NextResponse.json({ awarded: false, reason: 'empty-prize-pool', seasonName: cfg.seasonName, triggerType, oddsUsed });
    }

    const pointsAwarded = Number(prize.pointsValue ?? 0);

    // Resolve app user name snapshot
    const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
    const userName = userDoc.exists ? String((userDoc.data() as any)?.name || (userDoc.data() as any)?.displayName || 'User') : 'User';

    const totalRef = adminDb().collection('solarMadnessTotals').doc(decoded.uid);

    await adminDb().runTransaction(async (tx) => {
      const totalSnap = await tx.get(totalRef);
      const currentPoints = totalSnap.exists ? Number((totalSnap.data() as any)?.points || 0) : 0;
      const newPoints = currentPoints + pointsAwarded;

      tx.set(eventRef, {
        uid: decoded.uid,
        userName,
        leadId,
        dispositionId: dispositionId || null,
        dispositionName: dispositionName || null,
        triggerType,
        oddsUsed,
        prize,
        pointsAwarded,
        createdAt: new Date(),
      });

      tx.set(totalRef, {
        uid: decoded.uid,
        seasonName: cfg.seasonName,
        points: newPoints,
        updatedAt: new Date(),
      }, { merge: true });
    });

    const totalDoc = await totalRef.get();
    const totalPoints = totalDoc.exists ? Number((totalDoc.data() as any)?.points || 0) : pointsAwarded;

    return NextResponse.json({
      awarded: true,
      seasonName: cfg.seasonName,
      triggerType,
      oddsUsed,
      prize,
      pointsAwarded,
      totalPoints,
      eventId: idempotencyKey,
    });
  } catch (error: any) {
    console.error('[SolarMadness] award error:', error);
    return NextResponse.json({ error: error?.message || 'Internal error' }, { status: 500 });
  }
}
