import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import { membersFromTerritories } from '@/app/utils/teamAreas';
import type { Territory } from '@/app/types/territory';

function serializeTerritory(id: string, data: Record<string, unknown>): Territory {
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
    createdAt: data.createdAt ? new Date(String(data.createdAt)) : new Date(0),
    createdBy: String(data.createdBy || ''),
  };
}

async function requireRaydarUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing credentials'), { status: 401 });
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    throw Object.assign(new Error('Missing credentials'), { status: 401 });
  }

  const decoded = await adminAuth().verifyIdToken(idToken);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    throw Object.assign(new Error('User not found'), { status: 403 });
  }
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  try {
    await requireRaydarUid(request);

    const [territorySnap, userSnap] = await Promise.all([
      adminDb().collection('territories').get(),
      adminDb().collection('users').get(),
    ]);

    const users = userSnap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        name: String(data.name || 'Unknown'),
        color: typeof data.color === 'string' ? data.color : undefined,
        currentLocation: data.currentLocation,
      };
    });

    const territories = territorySnap.docs
      .map((doc) => serializeTerritory(doc.id, doc.data() as Record<string, unknown>))
      .filter((territory) => territory.polygon.length >= 3)
      .map((territory) => {
        const owner = users.find((user) => user.id === territory.userId);
        return {
          ...territory,
          userColor: owner?.color || territory.userColor,
          userName: owner?.name || territory.userName,
        };
      });

    const members = membersFromTerritories(territories, users);

    return NextResponse.json({ territories, members });
  } catch (error: any) {
    const status = error?.status || (error?.code === 'auth/argument-error' ? 401 : 500);
    if (status === 500) {
      console.error('[team-areas] GET error:', error);
    }
    return NextResponse.json(
      { error: error?.message || 'Internal error' },
      { status }
    );
  }
}
