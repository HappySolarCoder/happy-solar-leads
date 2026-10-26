import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { getLocation, watchLocation, type LocationPosition, type LocationError } from '@/app/utils/geolocation';
import { noteWarmFix } from '@/app/field/warmGps';

export interface GpsPosition { lat: number; lng: number; accuracy: number; timestamp: number }
export type GeolocationError = LocationError;

export function useGeolocation(options?: PositionOptions & { watch?: boolean }) {
  const [position, setPosition] = useState<GpsPosition | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(v => v + 1), []);
  const [activation, setActivation] = useState(0);
  const [error, setError] = useState<GeolocationError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { enableHighAccuracy = true, timeout = 10000, maximumAge = 0, watch = true } = options ?? {};

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let stopWatch: (() => Promise<void>) | undefined;
    let firstFixTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      generation += 1;
      clearTimeout(firstFixTimer);
      if (stopWatch) void stopWatch().catch(() => {});
      stopWatch = undefined;
    };
    const start = async () => {
      stop();
      const current = generation;
      const isCurrent = () => !disposed && current === generation;
      let first = true;
      const success = (pos: LocationPosition) => {
        if (!isCurrent()) return;
        clearTimeout(firstFixTimer);
        if (first) { first = false; setActivation(value => value + 1); }
        noteWarmFix(pos);
        setPosition(previous => previous && previous.lat === pos.coords.latitude && previous.lng === pos.coords.longitude && previous.accuracy === pos.coords.accuracy ? previous : { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
        setError(null);
        setIsLoading(false);
      };
      const failure = (err: LocationError) => {
        if (!isCurrent()) return;
        clearTimeout(firstFixTimer);
        setError(err);
        setIsLoading(false);
      };
      setIsLoading(true);
      // Some iOS simulators never emit a first watch result until a location
      // is supplied. Stop the spinner, but retain the watch for a later fix.
      firstFixTimer = setTimeout(() => failure({ code: 3,
        message: 'Location is taking longer than expected. You can keep browsing the map.' }),
        Number.isFinite(timeout) ? Math.max(timeout, 1000) : 10_000);
      const settings = { enableHighAccuracy, timeout, maximumAge };
      if (watch) {
        const cleanup = await watchLocation(success, failure, settings);
        if (isCurrent()) stopWatch = cleanup;
        else void cleanup().catch(() => {});
      } else {
        getLocation(settings).then(success, failure);
      }
    };
    void start();
    // Location is foreground-only. Release GPS while backgrounded and restart
    // on resume, including after a permission change in the phone's Settings.
    const listener = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => { if (isActive && !disposed) void start(); else stop(); })
      : null;
    const visible = () => { if (document.visibilityState === 'visible') void start(); else stop(); };
    if (!Capacitor.isNativePlatform()) document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      disposed = true;
      stop();
      if (listener) void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, [enableHighAccuracy, timeout, maximumAge, watch, attempt]);

  return { position, error, isLoading, activation, retry };
}

// Helper: Calculate distance between two points (Haversine formula)
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Helper: Format distance for display
export function formatDistance(miles: number): string {
  if (miles < 0.1) {
    return `${Math.round(miles * 5280)} ft`;
  } else if (miles < 1) {
    return `${(miles * 5280).toFixed(0)} ft`;
  } else {
    return `${miles.toFixed(1)} mi`;
  }
}
