import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createFieldHandlers } from "@/app/utils/server/fieldWork";
export const runtime = "nodejs";
const handlers = createFieldHandlers({ adminAuth, adminDb });
export const GET = handlers.GET;
export const POST = handlers.POST;
