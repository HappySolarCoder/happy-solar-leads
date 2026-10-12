import { getStorage } from 'firebase-admin/storage';
import { adminAuth, adminDb, getAdminApp } from '@/app/utils/firebase-admin';
import { createFeedbackHandlers } from '@/app/utils/server/mobileFeedback';
export const {GET,POST} = createFeedbackHandlers({auth:adminAuth,db:adminDb,bucket:()=>getStorage(getAdminApp()).bucket(process.env.FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0395385938.firebasestorage.app')});
