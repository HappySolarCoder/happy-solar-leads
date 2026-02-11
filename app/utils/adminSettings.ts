import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface AdminSettings {
  schedulingManagerPhone: string;
  notificationWebhook: string;
  notificationType: 'discord' | 'googlechat' | 'slack' | 'webhook';
}

const SETTINGS_DOC_ID = 'global';

export async function getAdminSettingsAsync(): Promise<AdminSettings | null> {
  try {
    if (!db) {
      console.error('Firestore not initialized');
      // Fallback to localStorage
      const localStr = localStorage.getItem('raydar_admin_settings');
      return localStr ? JSON.parse(localStr) : null;
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return docSnap.data() as AdminSettings;
    }
    
    // Fallback to localStorage for backwards compatibility
    const localStr = localStorage.getItem('raydar_admin_settings');
    if (localStr) {
      const local = JSON.parse(localStr);
      // Migrate to Firestore
      await saveAdminSettingsAsync(local);
      return local;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting admin settings:', error);
    return null;
  }
}

export async function saveAdminSettingsAsync(settings: AdminSettings): Promise<void> {
  try {
    if (!db) {
      console.error('Firestore not initialized - saving to localStorage only');
      localStorage.setItem('raydar_admin_settings', JSON.stringify(settings));
      return;
    }

    const docRef = doc(db, 'adminSettings', SETTINGS_DOC_ID);
    await setDoc(docRef, settings);
    
    // Also save to localStorage as backup
    localStorage.setItem('raydar_admin_settings', JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving admin settings:', error);
    throw error;
  }
}
