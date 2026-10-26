import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/app/utils/firebase-admin';
import {
  LEAD_PAGE,
  handleTooFarKnockAlert,
  type AlertEmail,
} from '@/app/utils/server/tooFarKnockAlert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MARKER_COLLECTION = 'tooFarKnockAlerts';

async function sendResend(apiKey: string, message: AlertEmail): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    }),
  });
  if (!response.ok) throw new Error(`resend ${response.status}`);
}

async function run(request: NextRequest) {
  const db = adminDb();
  const result = await handleTooFarKnockAlert(request, {
    env: process.env,
    now: () => new Date(),
    fetchPage: async (startMs, endMs, cursor) => {
      let query = db.collection('leads')
        .where('dispositionedAt', '>=', Timestamp.fromMillis(startMs))
        .where('dispositionedAt', '<', Timestamp.fromMillis(endMs))
        .orderBy('dispositionedAt')
        .limit(LEAD_PAGE);
      if (cursor?.cursor) query = query.startAfter(cursor.cursor as QueryDocumentSnapshot);
      const snap = await query.get();
      return {
        size: snap.size,
        docs: snap.docs.map((doc) => ({
          id: doc.id,
          data: () => doc.data() as Record<string, unknown>,
          cursor: doc,
        })),
      };
    },
    getUsers: async (uids) => {
      const refs = uids.map((uid) => db.collection('users').doc(uid));
      const snaps = refs.length ? await db.getAll(...refs) : [];
      const users = new Map<string, Record<string, unknown> | null>();
      snaps.forEach((snap, index) => {
        users.set(uids[index] || snap.id, snap.exists ? (snap.data() as Record<string, unknown>) : null);
      });
      return users;
    },
    claimMarker: async (day, data) => {
      const ref = db.collection(MARKER_COLLECTION).doc(day);
      const outcome = { claimed: false };
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        outcome.claimed = !snap.exists;
        if (snap.exists) return;
        tx.create(ref, data);
      });
      return outcome.claimed;
    },
    releaseMarker: async (day) => {
      await db.collection(MARKER_COLLECTION).doc(day).delete();
    },
    sendEmail: (message) => sendResend(process.env.RESEND_API_KEY!.trim(), message),
  });
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = run;
export const POST = run;
