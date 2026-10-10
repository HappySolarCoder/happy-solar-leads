import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createFieldConfigHandlers } from "@/app/utils/server/fieldConfig";
export const runtime = "nodejs";
const handlers = createFieldConfigHandlers({ adminAuth, adminDb });
export const GET = handlers.GET;
export const POST = handlers.POST;
