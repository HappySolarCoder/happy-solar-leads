import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createTerritoryHandlers } from "@/app/utils/server/territoryManagement";
import { invalidateTerritoryCache } from "@/app/utils/server/fieldOwnership";
import { invalidateMobileTerritoryCache } from "@/app/utils/server/mobileOwnership";
export const runtime = "nodejs";
const handlers = createTerritoryHandlers({ adminAuth, adminDb });
export const GET = handlers.GET;
// A saved territory changes who owns pins. Clear this instance's polygon caches (other
// instances catch up within their own TTL: 60 s for dispo, 5 min for /api/mobile-leads).
export async function POST(req: NextRequest) {
  const response = await handlers.POST(req);
  if (response.ok) {
    invalidateTerritoryCache();
    invalidateMobileTerritoryCache();
  }
  return response;
}
