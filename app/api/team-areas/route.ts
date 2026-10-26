import { NextRequest, NextResponse } from 'next/server';
import type { Query } from 'firebase-admin/firestore';
import { adminDb } from '@/app/utils/firebase-admin';
import { membersFromTerritories } from '@/app/utils/teamAreas';
import { requireApprovedRequestUser } from '@/app/utils/server/requireApprovedUser';
import type { Territory } from '@/app/types/territory';

export const TEAM_AREA_TERRITORY_LIMIT = 200;

export function withTerritoryTruncation<T extends Record<string, unknown>>(
  body: T,
  count: number,
): T & { truncated?: true } {
  if (count >= TEAM_AREA_TERRITORY_LIMIT) return { ...body, truncated: true };
  return body;
}

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

export async function GET(request: NextRequest) {
  try {
    const { uid, role } = await requireApprovedRequestUser(request);
    const summary = request.nextUrl.searchParams.get('summary') === '1';
    const ownOnly = summary && !['admin', 'manager'].includes(role);

    let territoryQuery: Query = adminDb().collection('territories');
    if (summary && ownOnly) territoryQuery = territoryQuery.where('userId', '==', uid);
    if (summary) {
      territoryQuery = territoryQuery.select('userId', 'userName', 'userColor', 'polygon', 'archived', 'createdAt', 'createdBy', 'leadCount');
    }
    territoryQuery = territoryQuery.limit(TEAM_AREA_TERRITORY_LIMIT);

    const [territorySnap, userSnap] = await Promise.all([
      territoryQuery.get(),
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
    if (territorySnap.size >= TEAM_AREA_TERRITORY_LIMIT) {
      console.log('[team-areas] territories truncated');
    }

    return NextResponse.json(withTerritoryTruncation({ territories, members }, territorySnap.size));
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
