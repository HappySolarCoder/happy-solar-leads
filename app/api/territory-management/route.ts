import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createTerritoryHandlers } from "@/app/utils/server/territoryManagement";
export const runtime = "nodejs";
const handlers = createTerritoryHandlers({ adminAuth, adminDb });
export const GET = handlers.GET;
export const POST = handlers.POST;
