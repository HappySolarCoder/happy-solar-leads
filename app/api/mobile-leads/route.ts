import { createMobileLeadHandler } from '@/app/utils/server/mobileLeads';
import { adminAuth, adminDb } from '@/app/utils/firebase-admin';
export const GET = createMobileLeadHandler({adminAuth, adminDb});
