"use client";

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";
import {
  clearHotOverviewBackoff,
  fetchHotOverview,
  type HotOverviewPoint,
} from "@/app/hotLeads/overview";
import type { User } from "@/app/types";

const EMPTY_POINTS: HotOverviewPoint[] = [];

/**
 * One overview fetch when 3PL-only zoomed-out mode turns on. Pan and zoom do
 * not refetch; coming back online or resuming the app only rechecks the TTL.
 */
export function useHotOverview(user: User | null, active: boolean) {
  const [snapshot, setSnapshot] = useState<{
    userId: string;
    points: HotOverviewPoint[];
    ready: boolean;
    unavailable: boolean;
  }>({ userId: "", points: EMPTY_POINTS, ready: false, unavailable: false });
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? "";

  useEffect(() => {
    if (!active) return;
    const person = user;
    if (!person) return;
    let alive = true;
    void (async () => {
      const token = await auth?.currentUser?.getIdToken().catch(() => "");
      if (!alive || !token || auth?.currentUser?.uid !== person.id) return;
      const result = await fetchHotOverview({
        user: person,
        token,
        fetcher: (url, init) => apiFetch(url, { headers: init.headers }),
      });
      if (!alive || auth?.currentUser?.uid !== person.id) return;
      setSnapshot({
        userId: person.id,
        points: result.points,
        ready: result.points.length > 0,
        unavailable: result.unavailable,
      });
    })();
    return () => {
      alive = false;
    };
  }, [active, user, attempt]);

  useEffect(() => {
    if (!active) return;
    const wake = () => {
      clearHotOverviewBackoff();
      setAttempt((value) => value + 1);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) wake();
        })
      : null;
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
      void listener?.then((handle) => handle.remove()).catch(() => {});
    };
  }, [active]);

  const current = snapshot.userId === userId ? snapshot : null;
  return {
    points: current?.points ?? EMPTY_POINTS,
    ready: current?.ready ?? false,
    unavailable: current?.unavailable ?? false,
  };
}
