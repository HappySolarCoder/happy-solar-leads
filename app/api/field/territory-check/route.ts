import { createTerritoryCheckHandler } from '@/app/utils/server/territoryCheck';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';

export const runtime = 'nodejs';
export const POST = createTerritoryCheckHandler({ adminAuth, adminDb });
