"use client";
import { isDeviceOnline } from "@/app/utils/connectivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";
import type { Lead, User } from "@/app/types";
import {
  DEFAULT_FIELD_CONFIG,
  type FieldConfig,
  type FieldMutation,
  type PendingMutation,
} from "./types";
import { cleanConfig } from "./config";
import { pilotFlags } from "./analysis";
import {
  putArea,
  readArea,
  readDrafts,
  putDraft,
  removeDraft,
  overlayDrafts,
  type PreparedArea,
} from "./deviceStore";

export async function fieldRequest(path: string, body?: unknown) {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw Error("Sign in to use field tools.");
  const response = await apiFetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = {
      error:
        response.status === 404
          ? "The v11 field backend needs deploying. Your existing knocking tools still work."
          : "Field service unavailable.",
    };
  }
  if (!response.ok)
    throw Object.assign(Error(data.error || "Field service unavailable."), {
      status: response.status,
    });
  return data;
}
import { syncOutbox } from "./syncOutbox";
const locks = new Set<string>();
export function useFieldData(user: User | null, liveLeads: Lead[]) {
  const uid = user?.id || "",
    active = useRef(uid);
  active.current = uid;
  const latest = useRef({user,liveLeads});latest.current={user,liveLeads};
  const [state, setState] = useState<{
    uid: string;
    config: FieldConfig;
    drafts: PendingMutation[];
    area: PreparedArea | null;
    error: string;
    ready: boolean;
  }>({
    uid: "",
    config: DEFAULT_FIELD_CONFIG,
    drafts: [],
    area: null,
    error: "",
    ready: false,
  });
  const [offline, setOffline] = useState(false),
    [syncing, setSyncing] = useState(false);
  const current =
    state.uid === uid
      ? state
      : {
          uid,
          config: DEFAULT_FIELD_CONFIG,
          drafts: [],
          area: null,
          error: "",
          ready: false,
        };
  const update = useCallback(
    (patch: Partial<typeof state>) => {
      if (active.current === uid)
        setState((s) => ({
          ...(s.uid === uid
            ? s
            : {
                config: DEFAULT_FIELD_CONFIG,
                drafts: [],
                area: null,
                error: "",
                ready: false,
              }),
          ...patch,
          uid,
        }));
    },
    [uid],
  );
  const reloadDrafts = useCallback(async () => {
    if (uid) update({ drafts: await readDrafts(uid) });
  }, [uid, update]);
  const loadConfig = useCallback(async () => {
    if (!uid || !isDeviceOnline()) return;
    try {
      const data = await fieldRequest("/api/field-config");
      update({ config: cleanConfig(data.config), ready: true, error: "" });
    } catch (e) {
      update({ error: (e as Error).message });
    }
  }, [uid, update]);
  const sync = useCallback(async () => {
    if (
      !uid ||
      locks.has(uid) ||
      !isDeviceOnline() ||
      auth?.currentUser?.uid !== uid
    )
      return;
    locks.add(uid);
    setSyncing(true);
    try {
      const result = await syncOutbox({
        read: () => readDrafts(uid),
        send: async m => {
          const result = await fieldRequest('/api/field-work', m);
          if (m.kind === 'knock' && !result.replayed && active.current === uid) {
            // Existing rewards run only after a confirmed write, never for a pending draft.
            void (async () => {
              let egg, madness;
              try { const { checkEasterEggTrigger } = await import('@/app/utils/easterEggs'); egg = await checkEasterEggTrigger(m.leadId, uid, latest.current.user?.name || '', latest.current.liveLeads.find(l => l.id === m.leadId)?.address || ''); } catch {}
              try { const token = await auth?.currentUser?.getIdToken(); if (token && auth?.currentUser?.uid === uid) { const { awardSolarMadnessAsync } = await import('@/app/utils/solarMadness'); madness = await awardSolarMadnessAsync({idToken:token,leadId:m.leadId,dispositionId:m.status,dispositionName:m.disposition}); } } catch {}
              if (active.current === uid && (egg || madness?.awarded)) window.dispatchEvent(new CustomEvent('raydar-field-award', {detail:{leadId:m.leadId,egg,madness}}));
            })();
          }
          return result;
        },
        remove: removeDraft,
        block: putDraft,
        active: () => active.current === uid && auth?.currentUser?.uid === uid && isDeviceOnline(),
      });
      if (result.error) update({ error: result.error });
      await reloadDrafts();
    } catch (e) {
      update({ error: (e as Error).message });
    } finally {
      locks.delete(uid);
      if (active.current === uid) setSyncing(false);
    }
  }, [uid, update, reloadDrafts]);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    setOffline(!isDeviceOnline());
    void Promise.all([readArea(uid), readDrafts(uid)])
      .then(([area, drafts]) => {
        if (alive) {
          update({
            area,
            drafts,
            ...(!isDeviceOnline() && area
              ? { config: area.config, ready: true }
              : {}),
          });
          void loadConfig();
          void sync();
        }
      })
      .catch((e) => {
        if (alive) {
          update({ error: e.message });
          void loadConfig();
        }
      });
    const online = () => {
      setOffline(!isDeviceOnline());
      if (isDeviceOnline()) {
        void loadConfig();
        void sync();
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("raydar-network-change", online);
    window.addEventListener("offline", online);
    const visible = () => {
      if (document.visibilityState === "visible") online();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      window.removeEventListener("online", online);
      window.removeEventListener("raydar-network-change", online);
      window.removeEventListener("offline", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [uid, update, loadConfig, sync]);
  const enqueue = useCallback(
    async (m: FieldMutation) => {
      if (!uid || m.userId !== uid || auth?.currentUser?.uid !== uid)
        throw Error("Your account changed. Sign in again.");
      const drafts = await readDrafts(uid);
      if (drafts.length >= 500)
        throw Error(
          "You have 500 pending changes. Sync or review them before adding more.",
        );
      if (drafts.some((x) => x.leadId === m.leadId && x.blocked))
        throw Error(
          "This pin has a sync conflict. Open Field tools → Sync to review it first.",
        );
      await putDraft(m);
      await reloadDrafts();
      void sync();
    },
    [uid, reloadDrafts, sync],
  );
  const discard = useCallback(
    async (id: string) => {
      const m = (await readDrafts(uid)).find((x) => x.id === id);
      if (!m) return;
      await removeDraft(id);
      await reloadDrafts();
    },
    [uid, reloadDrafts],
  );
  const prepare = useCallback(
    async (leads: Lead[]) => {
      if (!user || !current.ready || !isDeviceOnline())
        throw Error("Connect and load field settings before preparing doors.");
      const area = {
        userId: uid,
        user,
        at: Date.now(),
        leads: leads.slice(0, current.config.maxCacheDoors),
        config: current.config,
      };
      if (JSON.stringify(area).length > 15_000_000)
        throw Error(
          "These doors have too much history to prepare together. Narrow the street or ZIP search and retry.",
        );
      await putArea(area);
      update({ area });
      return area.leads.length;
    },
    [user, uid, current.ready, current.config, update],
  );
  const source = offline && current.area ? current.area.leads : liveLeads;
  const leads = useMemo(
    () => overlayDrafts(source, current.drafts),
    [source, current.drafts],
  );
  return {
    ...current,
    ...pilotFlags(current.config, uid),
    leads,
    offline,
    syncing,
    enqueue,
    sync,
    discard,
    prepare,
    loadConfig,
  };
}
