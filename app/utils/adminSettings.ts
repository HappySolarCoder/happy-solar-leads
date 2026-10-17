import { auth, db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { phoneOnly, resolveSchedulingRead } from './schedulingAccess';

export interface AdminSettings {
  schedulingManagerPhone: string;
}

const SETTINGS_DOC_ID = 'global';

function phoneFromLocalStorage(): { schedulingManagerPhone?: string } | null {
  if (typeof localStorage === 'undefined') return null;
  const localStr = localStorage.getItem('raydar_admin_settings');
  if (!localStr) return null;
  return phoneOnly(JSON.parse(localStr));
}

async function readSchedulingPhone(): Promise<{ schedulingManagerPhone?: string } | null> {
  if (!db) {
    console.error('Firestore not initialized');
    return phoneFromLocalStorage();
  }

  const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    // A stored document is not copied back from localStorage, and only the phone is kept.
    return phoneOnly(docSnap.data()) ?? { schedulingManagerPhone: '' };
  }
  return phoneFromLocalStorage();
}

/** Phone for the Call link. A denied or missing read returns null and does not disable Send. */
export async function getAdminSettingsAsync(): Promise<AdminSettings | null> {
  const uid = auth?.currentUser?.uid || '';
  const result = await resolveSchedulingRead(uid, readSchedulingPhone);
  if (result.status !== 'ready') return null;
  const phone = result.settings.schedulingManagerPhone?.trim() || '';
  if (!phone) return null;
  return { schedulingManagerPhone: phone };
}
