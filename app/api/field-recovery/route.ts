import { adminAuth, adminDb } from "@/app/utils/firebase-admin";
import { createRecoveryHandlers } from "@/app/utils/server/fieldRecovery";
export const runtime = "nodejs";
const handlers = createRecoveryHandlers({
  adminAuth,
  adminDb,
  secret: () => process.env.RAYDAR_RECOVERY_SECRET,
  enabled: () => process.env.RAYDAR_RECOVERY_PUBLIC_ENABLED === "true",
});
export const GET = handlers.GET;
export const POST = handlers.POST;
