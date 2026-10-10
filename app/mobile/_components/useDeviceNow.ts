"use client";

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/** Device-local Date, refreshed at minute boundaries and after returning to the app. */
export function useDeviceNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      if (!active) return;
      clearTimeout(timer);
      setNow(new Date());
      timer = setTimeout(refresh, 60000 - (Date.now() % 60000) + 25);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    timer = setTimeout(refresh, 60000 - (Date.now() % 60000) + 25);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refresh();
        })
      : null;
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      void listener?.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);
  return now;
}
