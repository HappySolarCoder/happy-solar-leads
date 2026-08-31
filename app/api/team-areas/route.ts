import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import {
  membersFromUserRecords,
  parseCurrentLocation,
} from '@/app/utils/teamAreas';

function serializeTerritory(id: string, data: Record<string, unknown>) {
  const polygonRaw = Array.isArray(data.polygon) ? data.polygon : [];
  const polygon = polygonRaw
    .map((point: any) => ({
      lat: Number(point?.lat),
      lng: Number(point?.lng),
    }))
    .filter((point: { lat: number; lng: number }) =>
      Number.isFinite(point.lat) && Number.isFinite(point.lng)
    );

  return {
    id,
    userId: String(data.userId || ''),
    userName: String(data.userName || 'Unknown'),
    userColor: String(data.userColor || '#FF5F5A'),
    polygon,
    leadIds: Array.isArray(data.leadIds) ? data.leadIds : [],
    createdAt: data.createdAt || null,
    createdBy: String(data.createdBy || ''),
  };
}

async function requireUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing credentials'), { status: 401 });
  }
  const idToken = authHeader.split(' ')[1];
  const decoded = await adminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  try {
    await requireUid(request);

    const [territorySnap, userSnap] = await Promise.all([
      adminDb().collection('territories').get(),
      adminDb().collection('users').get(),
    ]);

    const territories = territorySnap.docs
      .map((doc) => serializeTerritory(doc.id, doc.data() as Record<string, unknown>))
      .filter((territory) => territory.polygon.length >= 3);

    const members = membersFromUserRecords(
      userSnap.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          name: String(data.name || 'Unknown'),
          color: String(data.color || '#FF5F5A'),
          currentLocation: data.currentLocation,
        };
      })
    );

    return NextResponse.json({ territories, members });
  } catch (error: any) {
    const status = error?.status || 500;
    console.error('[team-areas] GET error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal error' },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const body = await request.json().catch(() => ({}));
    const parsed = parseCurrentLocation(
      { lat: body?.lat, lng: body?.lng, timestamp: Date.now() },
      Date.now(),
      Number.POSITIVE_INFINITY
    );
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid lat/lng' }, { status: 400 });
    }

    await adminDb().collection('users').doc(uid).set(
      {
        currentLocation: {
          lat: parsed.lat,
          lng: parsed.lng,
          timestamp: FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.status || 500;
    console.error('[team-areas] POST error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal error' },
      { status }
    );
  }
}
