"use client";
import { isDeviceOnline } from "@/app/utils/connectivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { acknowledgeMobileLead } from '@/app/hooks/useLiveLeads';
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
import { DIRECT_MOBILE_WRITES, directPatch, rejectCombinedKnockAndNotes } from './directWrites';
import { acceptDisposition, collapseLegacyNotesQueue, supersededNotesIds } from './draftQueue';
import { migrateDraft, reopenDeniedParked } from './draftMigration';
import { schedulingHold } from './draftState';
import { deliverFieldDispo, leadOwnedBy, prefersServerDispo, releaseFieldDispoHolds } from './serverDispo';
import { isHotLeadDraft } from '@/app/hotLeads/save';
import { enqueueDirectSave } from './enqueueDirectSave';
import { CONTACT_NOT_SENT_MESSAGE, assertContactReadyForSend, contactDraftBlocksSendInfo, parkContactDeniedDrafts, sendInfoMayWriteContact } from './sendInfoGate';
import { cachedTerritoryIds } from '@/app/hooks/useTeamAreasOverlay';
import { readSyncLog, recordSyncEvent, reportParked, type SyncEvent } from './syncDiagnostics';
import { displayedKnockPoint, type KnockPoint } from './knockPoint';
import { GPS_WINDOW_AFTER_MS } from './gpsPolicy';
import { noteAreaActor } from './areaGate';
import { resolveDraftGps, stageKnockGps } from './pendingGps';
import {
  putArea,
  readArea,
  readDrafts,
  putDraft,
  updatePendingGpsDraft,
  removeDraft,
  overlayDrafts,
  type PreparedArea,
} from "./deviceStore";

export async function fieldRequest(path: string, body?: unknown) {
  if (DIRECT_MOBILE_WRITES) throw Error('This optional field service is unavailable in the production mobile app. Knocks sync directly to Firestore.');
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
import { isProximityRequired } from '@/app/utils/proximityEnforcement';
import { syncOutbox } from "./syncOutbox";
import { SYNC_REASON } from "./syncReasons";
import { unreflectedKnocks } from "./confirmedKnocks";
const locks = new Map<string, Promise<void>>();
// NOTES-MERGE-SPEC V4 / v5 ruling 6: notes drafts that went pending in the current sync burst. A fresh sync()
// (no flush running) starts a new burst; a sync() that waited on a running flush reruns inside the same burst.
const heldNotesPending = new Map<string, Set<string>>();
export function useFieldData(user: User | null, liveLeads: Lead[]) {
  const uid = user?.id || "",
    active = useRef(uid);
  active.current = uid;
  const latest = useRef({user,liveLeads});latest.current={user,liveLeads};
  useEffect(() => { noteAreaActor(user); }, [user]);
  const [confirmedKnocks, setConfirmedKnocks] = useState<PendingMutation[]>([]);
  useEffect(() => {
    setConfirmedKnocks(previous => {
      const next = unreflectedKnocks(previous, liveLeads, uid);
      return next.length === previous.length ? previous : next;
    });
  }, [liveLeads, uid]);
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
    [syncing, setSyncing] = useState(false),
    [diagnostics, setDiagnostics] = useState<SyncEvent[]>([]);
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
  const reloadDiagnostics = useCallback(async () => {
    if (uid && active.current === uid) setDiagnostics(await readSyncLog(uid));
  }, [uid]);
  useEffect(() => {
    if (!uid || typeof window === "undefined") return;
    const refresh = () => { void reloadDiagnostics(); };
    window.addEventListener("raydar-sync-log", refresh);
    return () => window.removeEventListener("raydar-sync-log", refresh);
  }, [uid, reloadDiagnostics]);
  const loadConfig = useCallback(async () => {
    if (DIRECT_MOBILE_WRITES) {
      update({ config: DEFAULT_FIELD_CONFIG, ready: true });
      return;
    }
    if (!uid || !isDeviceOnline()) return;
    try {
      const data = await fieldRequest("/api/field-config");
      update({ config: cleanConfig(data.config), ready: true, error: "" });
    } catch (e) {
      update({ config: DEFAULT_FIELD_CONFIG, error: (e as Error).message });
    }
  }, [uid, update]);
  const runSync = useCallback(async (followUp: boolean): Promise<void> => {
    if (
      !uid ||
      !isDeviceOnline() ||
      auth?.currentUser?.uid !== uid
    )
      return;
    const ongoing = locks.get(uid);
    if (ongoing) {
      await ongoing;
      if (locks.get(uid) === ongoing) locks.delete(uid);
      return runSync(true);
    }
    if (!followUp) heldNotesPending.delete(uid);
    const held = heldNotesPending.get(uid) ?? new Set<string>();
    heldNotesPending.set(uid, held);
    const task = (async () => {
    try {
      const queued = await readDrafts(uid);
      if (!queued.length) return;
      // GPS resolves independently of network availability and never blocks another door.
      for (const m of queued) if (m.syncState === 'gps' && m.direct?.gps) void resolveDraftGps(m, {
        read: () => readDrafts(uid), put: updatePendingGpsDraft,
        active: () => active.current === uid && auth?.currentUser?.uid === uid,
      }).then(async () => { await reloadDrafts(); void runSync(false); }).catch(e => console.warn('[raydar-sync]', (e as Error).message));
      setSyncing(true);
      await syncOutbox({
        read: () => readDrafts(uid),
        send: async m => {
          const actor = latest.current.user;
          if (!actor || actor.id !== uid) throw Error('Sign in again to sync your work.');
          if (isHotLeadDraft(m)) {
            return deliverFieldDispo(m, actor, {
              getToken: async () => (await auth?.currentUser?.getIdToken()) || '',
              persistDraft: putDraft,
            });
          }
          const result = DIRECT_MOBILE_WRITES
            ? await deliverFieldDispo(m, actor, {
              getToken: async () => (await auth?.currentUser?.getIdToken()) || '',
              persistDraft: putDraft,
            })
            : await fieldRequest('/api/field-work', m);
          if (DIRECT_MOBILE_WRITES && result.lead && active.current === uid) acknowledgeMobileLead(actor, result.lead);
          // NOTES-MERGE-SPEC V4: a clear that kept other people's new notes says so.
          const notice = (result as { notice?: string }).notice;
          if (notice && active.current === uid) update({ error: notice });
          if (DIRECT_MOBILE_WRITES && m.kind === 'knock' && active.current === uid) {
            setConfirmedKnocks(previous => [...unreflectedKnocks(previous, latest.current.liveLeads, uid).filter(item => item.leadId !== m.leadId), m]);
          }
          if (!DIRECT_MOBILE_WRITES && m.kind === 'knock' && !result.replayed && active.current === uid) {
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
        update: putDraft,
        insert: putDraft,
        active: () => active.current === uid && auth?.currentUser?.uid === uid && isDeviceOnline(),
        heldNotesPending: held,
      });
      void reportParked(uid);
      await reloadDrafts();
      await reloadDiagnostics();
    } catch (e) {
      console.warn('[raydar-sync]', (e as Error).message);
      void recordSyncEvent({
        id: crypto.randomUUID(), userId: uid, at: Date.now(), draftId: '', leadId: '',
        createdAt: new Date().toISOString(), state: 'retry', lastError: (e as Error).message, attempts: 0,
      });
    } finally {
      if (active.current === uid) setSyncing(false);
    }
    })();
    locks.set(uid, task);
    try { await task; } finally { if (locks.get(uid) === task) locks.delete(uid); }
  }, [uid, reloadDrafts, reloadDiagnostics]);
  const sync = useCallback(() => runSync(false), [runSync]);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    setOffline(!isDeviceOnline());
    void Promise.all([readArea(uid), readDrafts(uid)])
      .then(async ([area, drafts]) => {
        // Recover existing API-backed knock/notes drafts exactly once. Preserve
        // their original time and rep; Firestore rules still authorize every write.
        const actor = latest.current.user;
        if (DIRECT_MOBILE_WRITES && actor?.id === uid && auth?.currentUser?.uid === uid) {
          const migrated = drafts.map((m) => migrateDraft(m, actor));
          const opened = releaseFieldDispoHolds(reopenDeniedParked(migrated, uid));
          const collapsed = collapseLegacyNotesQueue(opened);
          const kept = new Set(collapsed.map((row) => row.id));
          for (const row of collapsed) {
            const prev = drafts.find((item) => item.id === row.id);
            if (prev !== row) await putDraft(row);
          }
          for (const row of drafts) if (!kept.has(row.id)) await removeDraft(row.id);
          drafts = await readDrafts(uid);
          for (const m of drafts) if (m.syncState === 'gps' && m.direct?.gps) void resolveDraftGps(m, {
            read: () => readDrafts(uid), put: updatePendingGpsDraft,
            active: () => active.current === uid && auth?.currentUser?.uid === uid,
          }).then(async () => { await reloadDrafts(); void sync(); }).catch(e => console.warn('[raydar-sync]', (e as Error).message));
          void reloadDiagnostics();
        }
        if (alive) {
          update({
            area,
            drafts,
            ...(!DIRECT_MOBILE_WRITES && !isDeviceOnline() && area
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
    // The app retries transient failures while open. No reads when the queue is empty.
    const retryTimer = setInterval(() => { if (isDeviceOnline()) void sync(); }, 30000);
    return () => {
      alive = false;
      window.removeEventListener("online", online);
      window.removeEventListener("raydar-network-change", online);
      window.removeEventListener("offline", online);
      document.removeEventListener("visibilitychange", visible);
      clearInterval(retryTimer);
    };
  }, [uid, update, loadConfig, sync]);
  const enqueue = useCallback(
    async (m: FieldMutation) => {
      if (!uid || m.userId !== uid || auth?.currentUser?.uid !== uid) {
        const message = "Your account changed. Sign in again.";
        console.warn("[raydar-sync]", message);
        void recordSyncEvent({
          id: crypto.randomUUID(), userId: m.userId, at: Date.now(), draftId: m.id, leadId: m.leadId,
          createdAt: m.createdAt, state: "retry", lastError: message, attempts: 0,
          parkedReason: SYNC_REASON.permissionDenied,
        });
        throw Error(message);
      }
      let drafts = await readDrafts(uid);
      const expanded = collapseLegacyNotesQueue(drafts);
      if (expanded !== drafts) {
        const expandedIds = new Set(expanded.map((row) => row.id));
        for (const row of expanded) {
          const prev = drafts.find((item) => item.id === row.id);
          if (prev !== row) await putDraft(row);
        }
        for (const row of drafts) if (!expandedIds.has(row.id)) await removeDraft(row.id);
        drafts = expanded;
      }
      let stored;
      try { stored = acceptDisposition(drafts, m); }
      catch (e) {
        console.warn("[raydar-sync]", (e as Error).message);
        void recordSyncEvent({
          id: crypto.randomUUID(), userId: uid, at: Date.now(), draftId: m.id, leadId: m.leadId,
          createdAt: m.createdAt, status: m.status, disposition: m.disposition, state: "retry",
          lastError: (e as Error).message, attempts: 0,
        });
        throw e;
      }
      await putDraft(stored);
      for (const id of supersededNotesIds(drafts, stored)) await removeDraft(id);
      await reloadDrafts();
      if (stored.syncState === "parked") void recordSyncEvent({
        id: crypto.randomUUID(), userId: uid, at: Date.now(), draftId: stored.id, leadId: stored.leadId,
        createdAt: stored.createdAt, status: stored.status, disposition: stored.disposition,
        state: "parked", parkedReason: stored.parkedReason, lastError: stored.lastError, attempts: stored.attempts ?? 0,
      });
      if (stored.syncState === "gps" && stored.direct?.gps) void resolveDraftGps(stored, {
        read: () => readDrafts(uid), put: updatePendingGpsDraft,
        active: () => active.current === uid && auth?.currentUser?.uid === uid,
      }).then(async () => { await reloadDrafts(); void sync(); }).catch(e => console.warn("[raydar-sync]", (e as Error).message));
      void sync();
    },
    [uid, reloadDrafts, sync, update],
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
  const enqueueDirect = useCallback(async (lead: Lead, patch: Partial<Lead>, create?: Lead, deferGps = false, point?: KnockPoint | null, recordedAt?: Date) => {
    const actor = latest.current.user;
    if (!DIRECT_MOBILE_WRITES || !actor || actor.id !== uid || auth?.currentUser?.uid !== uid)
      throw Error('Sign in with the rep who is recording this action.');
    const stamped = recordedAt ?? new Date();
    rejectCombinedKnockAndNotes(patch);
    const clean = directPatch(patch), entry = clean.dispositionHistory?.[0];
    const tappedAt = entry?.timestamp ? new Date(entry.timestamp) : stamped;
    if (entry) clean.dispositionHistory = [entry];
    if (entry && (entry.userId !== uid || entry.userName !== actor.name))
      throw Error('The knock identity does not match the signed-in rep.');
    if (!current.area || !current.area.leads.some(l => l.id === lead.id)) {
      const area = { userId: uid, user: actor, at: Date.now(), config: DEFAULT_FIELD_CONFIG,
        leads: [lead, ...(current.area?.leads || latest.current.liveLeads).filter(l => l.id !== lead.id).slice(0, 24)] };
      await putArea(area); update({ area });
    }
    if (!entry) {
      const priors = (await readDrafts(uid)).filter((row) =>
        row.leadId === lead.id && row.kind === "notes" && row.parkedReason === SYNC_REASON.notesTooLong);
      await enqueueDirectSave({
        lead,
        patch: clean,
        actor,
        create,
        createdAt: tappedAt.toISOString(),
        parkedNotes: priors,
        enqueue,
      });
      return;
    }
    // History timestamp is the tap, captured before any GPS await. Save time is not the window.
    const shown = point === undefined ? displayedKnockPoint(lead, lead.homeowner) : point;
    const draftId = crypto.randomUUID();
    let staged: import('./types').PendingMutation = {
      id: draftId, userId: uid, userName: actor.name,
      leadId: lead.id, createdAt: tappedAt.toISOString(),
      kind: 'knock', baseStatus: lead.status, baseNotes: lead.notes || '',
      status: clean.status, disposition: entry.disposition,
      direct: {
        patch: clean,
        ...(create ? { create } : {}),
        ...(prefersServerDispo(lead, uid, actor.role) ? { serverDispo: true } : {}),
        ...(shown?.source === 'homeowner_corrected' && shown.homeownerId ? { homeownerId: shown.homeownerId } : {}),
        ...(shown ? { gpsPointSource: shown.source } : {}),
        ...(deferGps ? { gps: {
          ...(shown ? { lat: shown.lat, lng: shown.lng, source: shown.source } : {}),
          ...(shown?.homeownerId ? { homeownerId: shown.homeownerId } : {}),
          tappedAt: tappedAt.getTime(),
          deadline: tappedAt.getTime() + GPS_WINDOW_AFTER_MS,
          required: isProximityRequired(actor),
          areaOwned: leadOwnedBy(lead, uid),
        } } : {}),
      },
    };
    if (deferGps) staged = stageKnockGps(staged, Date.now());
    await enqueue(staged);
  }, [uid, enqueue, current.area, update]);
  const parkDeniedContact = useCallback(async (leadId: string) => {
    const drafts = await readDrafts(uid);
    for (const row of parkContactDeniedDrafts(drafts, leadId)) {
      await putDraft(row);
      await recordSyncEvent({
        id: crypto.randomUUID(),
        userId: uid,
        at: Date.now(),
        draftId: row.id,
        leadId: row.leadId,
        createdAt: row.createdAt,
        state: "parked",
        parkedReason: row.parkedReason,
        lastError: row.lastError,
        attempts: row.attempts ?? 0,
      });
    }
    await reloadDrafts();
  }, [uid, reloadDrafts]);
  const prepareSendInfo = useCallback(async (leadId: string) => {
    const actor = latest.current.user;
    const known = latest.current.liveLeads.find((row) => row.id === leadId)
      || current.area?.leads.find((row) => row.id === leadId);
    if (!DIRECT_MOBILE_WRITES) {
      if (!isDeviceOnline()) throw Error('Connect before sending the scheduling request.');
      await sync();
      const hold = schedulingHold(await readDrafts(uid), leadId);
      if (hold) throw Error(hold);
      return;
    }
    const stored = await readDrafts(uid);
    const contactDraft = stored.find((row) => row.leadId === leadId && row.kind === "contact" && row.syncState !== "parked")
      ?? stored.find((row) => row.leadId === leadId && row.kind === "contact");
    const canWrite = !!actor && sendInfoMayWriteContact(true, known, actor.id, actor.role, {
      patch: contactDraft?.direct?.patch,
      territoryIds: cachedTerritoryIds(actor.id),
    });
    if (!canWrite) {
      // Park existing contact drafts. Never delete them. Send Info still posts.
      await parkDeniedContact(leadId);
      return;
    }
    if (!isDeviceOnline()) {
      // Offline, and this role may write contact fields: the draft stays durably
      // queued. Send Info does not post. That is unchanged. An ambiguous
      // notification response is never retried.
      throw Error('Connect before sending the scheduling request.');
    }
    await sync();
    const drafts = await readDrafts(uid);
    if (contactDraftBlocksSendInfo(drafts, leadId)) assertContactReadyForSend(drafts, leadId);
    if (drafts.some((row) => row.leadId === leadId && row.kind === "contact" && row.syncState === "parked" && row.parkedReason === SYNC_REASON.contactDenied)) {
      throw Object.assign(Error(CONTACT_NOT_SENT_MESSAGE), { code: "contact_denied" });
    }
    const hold = schedulingHold(drafts, leadId);
    if (hold) throw Error(hold);
  }, [uid, sync, current.area, parkDeniedContact]);
  const ensureLeadSynced = useCallback(async (leadId: string) => {
    if (!isDeviceOnline()) throw Error('Connect before sending the scheduling request.');
    await sync();
    const hold = schedulingHold(await readDrafts(uid), leadId);
    if (hold) throw Error(hold);
  }, [uid, sync]);
  const retrySync = useCallback(async () => {
    await sync();
  }, [sync]);
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
  const source = useMemo(() => {
    if (offline && current.area) return current.area.leads;
    const ids = new Set(liveLeads.map(l => l.id)), pending = new Set(current.drafts.map(m => m.leadId));
    const extra = (current.area?.leads || []).filter(l => pending.has(l.id) && !ids.has(l.id));
    return extra.length ? [...liveLeads, ...extra] : liveLeads;
  }, [offline, current.area, liveLeads, current.drafts]);
  const leads = useMemo(
    () => overlayDrafts(source, [...unreflectedKnocks(confirmedKnocks, source, uid), ...current.drafts]),
    [source, current.drafts, confirmedKnocks, uid],
  );
  return {
    ...current,
    ...pilotFlags(DIRECT_MOBILE_WRITES ? DEFAULT_FIELD_CONFIG : current.config, uid),
    leads,
    offline,
    syncing,
    diagnostics,
    enqueue,
    enqueueDirect,
    ensureLeadSynced,
    prepareSendInfo,
    retrySync,
    sync,
    discard,
    prepare,
    loadConfig,
  };
}
