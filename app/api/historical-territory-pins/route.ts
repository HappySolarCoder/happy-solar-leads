import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
import type { Lead } from '@/app/types';
import type { Territory, TerritoryPoint } from '@/app/types/territory';
import {
  collectHistoricalStatusIds,
  selectHistoricalTerritoryPins,
  toPublicHistoricalPin,
} from '@/app/utils/historicalTerritoryPins';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      try {
        return (toDate as () => Date).call(value);
      } catch {
        return undefined;
      }
    }
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function mapLead(id: string, data: Record<string, unknown>): Lead {
  const history = Array.isArray(data.dispositionHistory)
    ? data.dispositionHistory.map((entry) => {
        const row = asRecord(entry);
        return {
          disposition: String(row.disposition || ''),
          timestamp: asDate(row.timestamp) || new Date(0),
          userId: String(row.userId || ''),
          userName: String(row.userName || ''),
        };
      })
    : undefined;

  return {
    id,
    name: String(data.name || ''),
    address: String(data.address || ''),
    city: String(data.city || ''),
    state: String(data.state || ''),
    zip: String(data.zip || ''),
    lat: typeof data.lat === 'number' ? data.lat : undefined,
    lng: typeof data.lng === 'number' ? data.lng : undefined,
    status: String(data.status || ''),
    disposition: data.disposition ? String(data.disposition) : undefined,
    dispositionedAt: asDate(data.dispositionedAt),
    createdAt: asDate(data.createdAt) || new Date(0),
    claimedBy: data.claimedBy ? String(data.claimedBy) : undefined,
    assignedTo: data.assignedTo ? String(data.assignedTo) : undefined,
    dispositionHistory: history,
  };
}

function mapTerritory(id: string, data: Record<string, unknown>): Territory {
  const polygon: TerritoryPoint[] = Array.isArray(data.polygon)
    ? data.polygon
        .map((point) => {
          const row = asRecord(point);
          return { lat: Number(row.lat), lng: Number(row.lng) };
        })
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    : [];

  return {
    id,
    userId: String(data.userId || ''),
    userName: String(data.userName || ''),
    userColor: String(data.userColor || '#9CA3AF'),
    polygon,
    leadIds: Array.isArray(data.leadIds) ? data.leadIds : [],
    createdAt: asDate(data.createdAt) || new Date(0),
    createdBy: String(data.createdBy || ''),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
    const uid = await requireRaydarUid(request);
    const db = adminDb();

    const territorySnap = await db.collection('territories').where('userId', '==', uid).get();
    const territories = territorySnap.docs
      .map((doc) => mapTerritory(doc.id, asRecord(doc.data())))
      .filter((territory) => territory.polygon.length >= 3);

    if (territories.length === 0) {
      return NextResponse.json({ pins: [] });
    }

    const dispositionSnap = await db.collection('dispositions').get();
    const statusIds = collectHistoricalStatusIds(
      dispositionSnap.docs.map((doc) => {
        const data = doc.data() as { name?: string };
        return { id: doc.id, name: data.name };
      }),
    );
    const extraStatusIds = new Set(statusIds);

    const byId = new Map<string, Lead>();
    // Firestore `in` is capped. Status-only queries use the automatic single-field index.
    for (const ids of chunk(statusIds, 10)) {
      const snap = await db.collection('leads').where('status', 'in', ids).get();
      for (const doc of snap.docs) {
        byId.set(doc.id, mapLead(doc.id, asRecord(doc.data())));
      }
    }

    const pins = selectHistoricalTerritoryPins(
      Array.from(byId.values()),
      uid,
      territories,
      extraStatusIds,
    ).map(toPublicHistoricalPin);

    return NextResponse.json({ pins });
  } catch (error: unknown) {
    const err = asRecord(error);
    const code = typeof err.code === 'string' ? err.code : undefined;
    const status = typeof err.status === 'number'
      ? err.status
      : code === 'auth/argument-error'
        ? 401
        : 500;
    if (status === 500) {
      console.error('[historical-territory-pins] GET error:', error);
    }
    const message = typeof err.message === 'string' ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status });
  }
}
