'use client';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { onAuthStateChanged } from 'firebase/auth';
import { useEffect } from 'react';
import { auth } from '@/app/utils/firebase';
import { isDeviceOnline } from '@/app/utils/connectivity';
import { flushQueuedEmpowerBumps, subscribeEmpowerAuthFlush } from './empowerBump';

/**
 * Same wake-ups as the field outbox: the phone comes online, the tab becomes
 * visible, or the installed app resumes. Queued bumps send once per wake.
 * Ambiguous bumps are not included.
 */
export default function EmpowerBumpSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const uid = auth?.currentUser?.uid;
      if (!uid || !isDeviceOnline()) return;
      void flushQueuedEmpowerBumps({
        uid,
        online: isDeviceOnline,
        getToken: async (forceRefresh) => (await auth?.currentUser?.getIdToken(forceRefresh)) || '',
      }).catch((error) => console.warn('[raydar-sync]', (error as Error).message));
    };
    const wake = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        flush();
      }, 50);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    window.addEventListener('online', wake);
    window.addEventListener('raydar-network-change', wake);
    document.addEventListener('visibilitychange', onVisible);
    const resume = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) wake();
        })
      : null;
    const stopAuth = subscribeEmpowerAuthFlush({
      subscribe: (listener) => (
        auth ? onAuthStateChanged(auth, (user) => listener(user?.uid ?? null)) : () => {}
      ),
      whenReady: () => (auth ? auth.authStateReady() : Promise.resolve()),
      onSignedIn: wake,
    });
    wake();
    return () => {
      if (timer) clearTimeout(timer);
      stopAuth();
      window.removeEventListener('online', wake);
      window.removeEventListener('raydar-network-change', wake);
      document.removeEventListener('visibilitychange', onVisible);
      void resume?.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
  return null;
}
