import { apiFetch } from '@/app/utils/apiFetch';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { resolveSchedulingRead, SchedulingAccessError } from './schedulingAccess';

export { SchedulingAccessError };

export interface AdminSettings {
  schedulingManagerPhone: string;
  notificationWebhook: string;
  notificationType: 'discord' | 'googlechat' | 'slack' | 'webhook';
}

const SETTINGS_DOC_ID = 'global';

export async function getAdminSettingsAsync(): Promise<AdminSettings | null> {
  const uid = auth?.currentUser?.uid || '';
  const result = await resolveSchedulingRead(uid, async () => {
    if (!db) {
      console.error('Firestore not initialized');
      const localStr = typeof localStorage !== 'undefined' ? localStorage.getItem('raydar_admin_settings') : null;
      return localStr ? JSON.parse(localStr) as AdminSettings : null;
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data() as AdminSettings;
    }

    // Fallback to localStorage for backwards compatibility. Never reached after a denial.
    const localStr = typeof localStorage !== 'undefined' ? localStorage.getItem('raydar_admin_settings') : null;
    if (localStr) {
      const local = JSON.parse(localStr) as AdminSettings;
      await saveAdminSettingsAsync(local);
      return local;
    }

    return null;
  });
  if (result.status === 'denied') throw new SchedulingAccessError();
  if (result.status === 'missing') return null;
  return result.settings;
}

export async function saveAdminSettingsAsync(settings: AdminSettings): Promise<void> {
  try {
    // Preferred: save via server API (Admin SDK) to avoid Firestore client rules issues
    if (auth?.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      const res = await apiFetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to save settings (${res.status})`);
      }

      // Backup (best-effort only; never fail save due to localStorage quota)
      try {
        localStorage.setItem('raydar_admin_settings', JSON.stringify(settings));
      } catch (e) {
        console.warn('Could not backup admin settings to localStorage (ignored):', e);
      }
      return;
    }

    // Fallback: if not authenticated yet, attempt Firestore direct write
    if (!db) {
      console.error('Firestore not initialized - saving to localStorage only');
      try {
        localStorage.setItem('raydar_admin_settings', JSON.stringify(settings));
      } catch (e) {
        console.warn('Could not save admin settings to localStorage (quota?)', e);
      }
      return;
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    await setDoc(docRef, settings);

    // Also save to localStorage as backup (best-effort)
    try {
      localStorage.setItem('raydar_admin_settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('Could not backup admin settings to localStorage (quota?)', e);
    }
  } catch (error) {
    console.error('Error saving admin settings:', error);
    throw error;
  }
}
