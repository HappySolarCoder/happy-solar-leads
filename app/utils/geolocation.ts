import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

export interface LocationPosition {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number };
}
export interface LocationError { code: number; message: string }

export function normalizeLocationError(error: unknown): LocationError {
  const e = error as { code?: string | number; message?: string } | null;
  const denied = ['OS-PLUG-GLOC-0003', 'OS-PLUG-GLOC-0008', 'OS-PLUG-GLOC-0009'];
  return {
    code: typeof e?.code === 'number' ? e.code
      : denied.includes(String(e?.code)) ? 1 : e?.code === 'OS-PLUG-GLOC-0010' ? 3 : 2,
    message: e?.message ?? 'Unable to get your location',
  };
}

export function isLocationAvailable(): boolean {
  return Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !!navigator.geolocation);
}

async function ensureNativePermission() {
  const status = await Geolocation.checkPermissions();
  if (status.location === 'granted') return;
  const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
  if (requested.location !== 'granted') {
    throw { code: 1, message: 'Enable precise location for Raydar in your phone settings.' };
  }
}

export async function getLocation(options: PositionOptions = {}): Promise<LocationPosition> {
  try {
    if (Capacitor.isNativePlatform()) {
      await ensureNativePermission();
      return await Geolocation.getCurrentPosition(options);
    }
    if (!isLocationAvailable()) throw { code: 2, message: 'Location is unavailable on this device.' };
    return await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  } catch (error) {
    throw normalizeLocationError(error);
  }
}

/** Returns an async cleanup; callers must also clean up watches created after unmount. */
export async function watchLocation(
  success: (position: LocationPosition) => void,
  failure: (error: LocationError) => void,
  options: PositionOptions = {},
): Promise<() => Promise<void>> {
  try {
    if (Capacitor.isNativePlatform()) {
      await ensureNativePermission();
      const id = await Geolocation.watchPosition(options, (position, error) => {
        if (error) failure(normalizeLocationError(error));
        else if (position) success(position);
      });
      return () => Geolocation.clearWatch({ id });
    }
    if (!isLocationAvailable()) throw { code: 2, message: 'Location is unavailable on this device.' };
    const id = navigator.geolocation.watchPosition(success, error => failure(normalizeLocationError(error)), options);
    return async () => navigator.geolocation.clearWatch(id);
  } catch (error) {
    failure(normalizeLocationError(error));
    return async () => {};
  }
}
