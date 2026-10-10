'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Capacitor, SystemBars, SystemBarsStyle, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';

/** Installed-app lifecycle only. The website continues using its existing PWA. */
export default function NativeRuntime() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (Capacitor.isNativePlatform() && ['/lead-management', '/territories', '/admin/assignments'].includes(pathname.replace(/\/$/, ''))) {
      router.replace('/mobile/territories');
    }
  }, [pathname, router]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    document.documentElement.dataset.native = Capacitor.getPlatform();
    let disposed = false;
    const listeners: PluginListenerHandle[] = [];
    const keep = (handle: PluginListenerHandle) => {
      if (disposed) void handle.remove();
      else listeners.push(handle);
    };

    async function initialize() {
      await Promise.all([SplashScreen.hide(), SystemBars.setStyle({ style: SystemBarsStyle.Light })]);
      keep(await Network.addListener('networkStatusChange', status => {
        if (!disposed) setOffline(!status.connected);
      }));
      const status = await Network.getStatus();
      if (!disposed) setOffline(!status.connected);
      if (Capacitor.getPlatform() === 'android') {
        keep(await App.addListener('backButton', ({ canGoBack }) => {
          const path = window.location.pathname.replace(/\/$/, '') || '/';
          if (['/', '/mobile', '/login'].includes(path)) void App.minimizeApp();
          else if (canGoBack) window.history.back();
          else router.replace('/mobile');
        }));
      }
    }
    void initialize().catch(error => console.warn('Native initialization failed', error));
    return () => {
      disposed = true;
      for (const listener of listeners) void listener.remove();
      delete document.documentElement.dataset.native;
    };
  }, [router]);

  if (!offline) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-[calc(env(safe-area-inset-bottom)+90px)] left-3 right-3 z-[10000] rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-lg pointer-events-none">
      <strong>You’re offline.</strong> Prepared field visits and notes can queue. Other actions and map imagery need a connection.
    </div>
  );
}
