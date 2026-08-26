'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;

    const checkForUpdate = () => {
      if (registration) {
        registration.update().catch(() => {});
      }
    };

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registered:', reg.scope);
        registration = reg;

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[PWA] New version available');
                setUpdateAvailable(true);
                // Optional skipWaiting — do not auto-reload the page
                newWorker.postMessage('SKIP_WAITING');
              }
            });
          }
        });

        // Check once on register
        checkForUpdate();
      })
      .catch((error) => {
        console.error('[PWA] Service Worker registration failed:', error);
      });

    const onFocus = () => checkForUpdate();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (updateAvailable) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-[#FF5F5A] text-white px-4 py-3 rounded-xl shadow-2xl animate-slide-up">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">New version ready — refresh when convenient</span>
        </div>
      </div>
    );
  }

  return null;
}
