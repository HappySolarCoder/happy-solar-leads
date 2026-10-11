"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/app/utils/firebase";
import { mapLeadDoc } from "@/app/utils/firestore";
import type { Lead, User } from "@/app/types";
import { firestoreFailure } from '@/app/utils/firestoreFailure';
import { startupEvent } from '@/app/mobile/_lib/startupDiagnostics';
import { isDeviceOnline } from '@/app/utils/connectivity';

// Same access scope as the existing lead loader: admins see all, everyone else
// sees only assigned/claimed records. No raw GHL collections or credentials on device.
export function useLiveLeads(user: User | null, retryAttempt = 0) {
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [result, setResult] = useState<{
    userId: string;
    owner: User | null;
    scope: string;
    leads: Lead[];
    error: string;
    errorCode?: string;
    cached: boolean;
  } | null>(null);
  const userId = user?.id;
  const role = user?.role;
  const scope = `${userId}:${role}`;
  useEffect(() => {
    if (!userId) return;
    if (!db) return;
    const source = collection(db, "leads");
    const queries =
      role === "admin"
        ? [query(source)]
        : [
            query(source, where("assignedTo", "==", userId)),
            query(source, where("claimedBy", "==", userId)),
          ];
    const records = queries.map(() => new Map<string, Lead>());
    const ready = queries.map(() => false);
    const cached = queries.map(() => true);
    let failed = false;
    let retryOnReconnect = false;
    let active = true;
    const startedAt = Date.now();
    startupEvent('leads-start');
    let combinedLeads: Lead[] = [];
    const cleanups = queries.map((q, index) =>
      onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!active || failed) return;
          const changes = snapshot.docChanges();
          for (const change of changes) {
            if (change.type === "removed") records[index].delete(change.doc.id);
            else {
              const lead = mapLeadDoc(change.doc);
              records[index].set(change.doc.id, lead);
              // Preserve the newest object across overlapping assigned/claimed queries.
              records.forEach((group, other) => {
                if (other !== index && group.has(lead.id))
                  group.set(lead.id, lead);
              });
            }
          }
          const firstSnapshot = !ready[index];
          ready[index] = true;
          const firstServerSnapshot = cached[index] && !snapshot.metadata.fromCache;
          cached[index] = snapshot.metadata.fromCache;
          if (firstServerSnapshot) startupEvent('leads-server-ready', startedAt);
          if (ready.every(Boolean)) {
            if (changes.length || firstSnapshot) {
              const combined = new Map<string, Lead>();
              records.forEach((group) =>
                group.forEach((lead, id) => combined.set(id, lead)),
              );
              combinedLeads = [...combined.values()];
            }
            setResult({
              owner: user,
              userId,
              scope,
              leads: combinedLeads,
              error: "",
              cached: cached.some(Boolean),
            });
          }
        },
        (error) => {
          if (!active || failed) return;
          failed = true;
          const failure = firestoreFailure(error);
          retryOnReconnect = failure.retryOnReconnect;
          startupEvent('leads-error', startedAt, { code: failure.code });
          // Both rep queries must stop together. A permission failure clears the
          // view; a transient failure can keep already received records visible.
          queueMicrotask(() => { if (active) cleanups.forEach(stop => stop()); });
          setResult({
            owner: user,
            userId,
            scope,
            leads: failure.retryOnReconnect ? combinedLeads : [],
            error: failure.message,
            errorCode: failure.code,
            cached: true,
          });
        },
      ),
    );
    const reconnect = () => {
      // Firestore manages normal offline reconnects itself. Only recreate a
      // terminally failed transient listener, never a healthy subscription.
      if (active && failed && retryOnReconnect && isDeviceOnline()) {
        retryOnReconnect = false;
        setReconnectAttempt(value => value + 1);
      }
    };
    window.addEventListener('online', reconnect);
    window.addEventListener('raydar-network-change', reconnect);
    return () => {
      active = false;
      failed = true;
      cleanups.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener('online', reconnect);
      window.removeEventListener('raydar-network-change', reconnect);
    };
  }, [userId, role, scope, user, retryAttempt, reconnectAttempt]);
  if (userId && !db)
    return {
      userId,
      leads: [],
      error: "Firebase is not configured for this build.",
      cached: true,
    };
  return result?.scope === scope && result.owner === user ? result : null;
}
