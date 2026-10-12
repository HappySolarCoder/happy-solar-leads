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

  const decoded = await adminAuth().verifyIdToken(idToken, true);
  const userDoc = await adminDb().collection('users').doc(decoded.uid).get();
  if (!userDoc.exists) {
    throw Object.assign(new Error('User not found'), { status: 403 });
  }
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  try {
    const uid = await requireRaydarUid(request);
    const summary = request.nextUrl.searchParams.get('summary') === '1';
    const caller = summary ? (await adminDb().collection('users').doc(uid).get()).data() : null;
    if (summary && (!caller || caller.deleted || caller.deletionPending || caller.isActive === false || caller.approved === false || caller.approvalStatus === 'pending')) return NextResponse.json({error:'This account cannot load territories.'},{status:403});
    const ownOnly = summary && !['admin','manager'].includes(caller?.role || '');

    const [territorySnap, userSnap] = await Promise.all([
      (summary ? (ownOnly ? adminDb().collection('territories').where('userId','==',uid) : adminDb().collection('territories')).select('userId','userName','userColor','polygon','archived','createdAt','createdBy','leadCount') : adminDb().collection('territories')).get(),
      (summary ? (ownOnly ? adminDb().collection('users').where('__name__','==',uid) : adminDb().collection('users')).select('name','color','currentLocation') : adminDb().collection('users')).get(),
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
      .filter(doc => !doc.data().archived)
      .map((doc) => serializeTerritory(doc.id, summary ? {...doc.data(),leadIds:[]} : doc.data() as Record<string, unknown>))
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
