"use client";
import { isDeviceOnline } from "@/app/utils/connectivity";
import { startTransition, useEffect, useState } from "react";
import type L from "leaflet";
import type { User } from "@/app/types";
import { firebaseConfig } from "@/app/utils/firebase";
import { HomeownerLoader, EMPTY_HOMES, type HomeownerState } from "./loader";
import { readTile, saveTile } from "./cache";
import { readHomeownerRange } from "./source";
const loaders = new Map<string, HomeownerLoader>();
export function useHomeowners(
  map: L.Map | null,
  user: User | null,
  enabled: boolean,
) {
  const scope = `${firebaseConfig.projectId || "unset"}:${user?.id || ""}`;
  const [state, setState] = useState<{ scope: string; value: HomeownerState }>({
    scope: "",
    value: EMPTY_HOMES,
  });
  const uid = user?.id;
  useEffect(() => {
    if (!map || !uid || !enabled) return;
    let alive = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    let loader = loaders.get(scope);
    if (!loader) {
      loader = new HomeownerLoader({
        read: (tile) => readTile(scope, tile),
        save: (tile) => saveTile(scope, tile),
        fetch: (range, zoom) => readHomeownerRange(range, zoom, uid),
        online: () => isDeviceOnline(),
      });
      loaders.set(scope, loader);
      while (loaders.size > 3) {
        const oldest = loaders.keys().next().value!;
        loaders.get(oldest)?.cancel();
        loaders.delete(oldest);
      }
    }
    const receive = (value: HomeownerState) => {
      if (alive) startTransition(() => setState({ scope, value }));
    };
    const cancel = () => {
      if (timer) clearTimeout(timer);
      loader!.cancel();
    };
    const schedule = () => {
      cancel();
      if (map.getZoom() < 15) {
        receive({ ...EMPTY_HOMES, zoomIn: true });
        return;
      }
      const b = map.getBounds();
      const view = {
        south: b.getSouth(), north: b.getNorth(),
        west: b.getWest(), east: b.getEast(), zoom: map.getZoom(),
      };
      // Saved homes do not wait for the network debounce or an older in-flight request.
      void loader!.preview(view, receive);
      timer = setTimeout(() => {
        loader!.request(view, receive);
      }, 500);
    };
    map.on("movestart zoomstart", cancel);
    map.on("moveend zoomend", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("raydar-network-change", schedule);
    window.addEventListener("offline", schedule);
    schedule();
    return () => {
      alive = false;
      cancel();
      map.off("movestart zoomstart", cancel);
      map.off("moveend zoomend", schedule);
      window.removeEventListener("online", schedule);
      window.removeEventListener("raydar-network-change", schedule);
      window.removeEventListener("offline", schedule);
    };
  }, [map, uid, scope, enabled]);
  return enabled && state.scope === scope ? state.value : EMPTY_HOMES;
}
