'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered:', reg.scope);
          setRegistration(reg);

          // Listen for updates
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New version available!');
                  setUpdateAvailable(true);
                  // Auto-activate the new version
                  newWorker.postMessage('SKIP_WAITING');
                }
              });
            }
          });

          // Check for updates immediately
          reg.update();

          // Check for updates every 10 seconds (aggressive)
          setInterval(() => {
            reg.update();
          }, 10000);
        })
        .catch((error) => {
          console.error('[PWA] Service Worker registration failed:', error);
        });

      // Listen for controller change (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] New service worker activated, reloading page...');
        // Auto-reload to get latest version
        window.location.reload();
      });
    }
  }, []);

  // Show update notification
  if (updateAvailable) {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-[#FF5F5A] text-white px-4 py-3 rounded-xl shadow-2xl animate-slide-up">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">🔄 Updating Raydar...</span>
        </div>
      </div>
    );
  }

  return null;
}
