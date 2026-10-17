import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toPublicAdminSettings, type AdminSettings } from './publicAdminSettings';

export type { AdminSettings } from './publicAdminSettings';

const SETTINGS_DOC_ID = 'global';
const LOCAL_SETTINGS_KEY = 'raydar_admin_settings';

function readLocalSettings(): AdminSettings | null {
  try {
    const localStr = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!localStr) return null;
    const parsed = toPublicAdminSettings(JSON.parse(localStr));
    if (!parsed) return null;
    // Older builds stored the webhook in the browser. Replace that copy.
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalSettings(settings: AdminSettings): void {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(toPublicAdminSettings(settings)));
  } catch (error) {
    console.warn('Could not backup admin settings to localStorage (ignored):', error);
  }
}

export async function getAdminSettingsAsync(): Promise<AdminSettings | null> {
  try {
    if (!db) {
      console.error('Firestore not initialized');
      return readLocalSettings();
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const settings = toPublicAdminSettings(docSnap.data());
      if (settings) writeLocalSettings(settings);
      return settings;
    }

    const local = readLocalSettings();
    if (local) {
      try {
        await saveAdminSettingsAsync(local);
      } catch (error) {
        console.error('Error migrating admin settings:', error);
      }
      return local;
    }

    return null;
  } catch (error) {
    console.error('Error getting admin settings:', error);
    return null;
  }
}

export async function saveAdminSettingsAsync(settings: AdminSettings): Promise<void> {
  const payload = toPublicAdminSettings(settings);
  if (!payload) throw new Error('Invalid settings');

  try {
    if (auth?.currentUser) {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to save settings (${res.status})`);
      }

      writeLocalSettings(payload);
      return;
    }

    if (!db) {
      console.error('Firestore not initialized - saving to localStorage only');
      writeLocalSettings(payload);
      return;
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    await setDoc(docRef, payload, { merge: true });
    writeLocalSettings(payload);
  } catch (error) {
    console.error('Error saving admin settings:', error);
    throw error;
  }
}
