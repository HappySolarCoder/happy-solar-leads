import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { getGhlDb } from '@/app/utils/ghl-firestore';
import { handleEmpowerBump, isEmpowerBumpEnabled } from '@/app/utils/server/empowerBump';
import { createGhlClient } from '@/app/utils/server/empowerBumpGhl';
import { createEventStore, createReceiptStore, type FirestoreLike } from '@/app/utils/server/empowerBumpStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function envId(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : undefined;
}

function services() {
  const token = process.env.GHL_API_KEY?.trim();
  if (!token) return null;
  let ghlDb: FirestoreLike;
  let raydarDb: FirestoreLike;
  try {
    ghlDb = getGhlDb() as unknown as FirestoreLike;
    raydarDb = adminDb() as unknown as FirestoreLike;
  } catch {
    return null;
  }
  const tag = process.env.EMPOWER_BUMP_GHL_TAG?.trim();
  return {
    ghl: createGhlClient({ token, fetch: (url, init) => fetch(url, init) }),
    receipts: createReceiptStore(raydarDb),
    events: createEventStore(ghlDb),
    optionalFields: {
      estimatedBandFieldId: envId('EMPOWER_BUMP_GHL_ESTIMATED_BAND_FIELD_ID'),
      assistanceFieldId: envId('EMPOWER_BUMP_GHL_ASSISTANCE_FIELD_ID'),
      tag: tag && tag.length <= 40 ? tag : undefined,
    },
  };
}

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    // Flag check first: off/unset means no body read, no auth read, no writes.
    if (!isEmpowerBumpEnabled(process.env.EMPOWER_BUMP_ENABLED)) {
      return NextResponse.json({ error: 'Empower bump is not configured.' }, { status: 503, headers });
    }

    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const result = await handleEmpowerBump({
      authorization: request.headers.get('authorization'),
      idempotencyKey: request.headers.get('idempotency-key'),
      body,
      deps: {
        isEnabled: () => isEmpowerBumpEnabled(process.env.EMPOWER_BUMP_ENABLED),
        verifyIdToken: (token, checkRevoked) => adminAuth().verifyIdToken(token, checkRevoked),
        getUser: async (uid) => {
          const doc = await adminDb().collection('users').doc(uid).get();
          return { exists: doc.exists, data: doc.data() };
        },
        getServices: services,
        // Event names and counts only. Never the body, token, or GHL payloads.
        log: (event, meta) => console.info(`[empower-bump] ${event}`, meta),
      },
    });

    return NextResponse.json(result.body, { status: result.status, headers: { ...headers, ...result.headers } });
  } catch {
    console.error('[empower-bump] failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers });
  }
}
