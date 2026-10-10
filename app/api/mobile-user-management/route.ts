import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createMobileUserHandlers } from "@/app/utils/server/mobileUserManagement";
export const runtime = "nodejs";
const handlers = createMobileUserHandlers({ adminAuth, adminDb });
export const GET = handlers.GET;
export const POST = handlers.POST;
