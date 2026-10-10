'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
const emptySnapshot = () => null;
// Hydration-safe device storage. No network subscription or cross-user state.
export function useDeviceValue(key: string, area: 'localStorage' | 'sessionStorage') {
  const [fallback, setFallback] = useState<string | null>(null);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener('storage', notify);
    window.addEventListener('raydar-device-state', notify);
    return () => {
      window.removeEventListener('storage', notify);
      window.removeEventListener('raydar-device-state', notify);
    };
  }, []);
  const snapshot = useCallback(() => {
    try { return window[area].getItem(key); } catch { return null; }
  }, [area, key]);
  const stored = useSyncExternalStore(subscribe, snapshot, emptySnapshot);
  const save = useCallback((value: string) => {
    try {
      window[area].setItem(key, value);
      setFallback(null);
      window.dispatchEvent(new Event('raydar-device-state'));
    } catch { setFallback(value); }
  }, [area, key]);
  return [fallback ?? stored, save] as const;
}
