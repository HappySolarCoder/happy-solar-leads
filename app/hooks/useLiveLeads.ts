"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/app/utils/firebase";
import { mapLeadDoc } from "@/app/utils/firestore";
import type { Lead, User } from "@/app/types";

// Same access scope as the existing lead loader: admins see all, everyone else
// sees only assigned/claimed records. No raw GHL collections or credentials on device.
export function useLiveLeads(user: User | null) {
  const [result, setResult] = useState<{
    userId: string;
    scope: string;
    leads: Lead[];
    error: string;
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
    let combinedLeads: Lead[] = [];
    const cleanups = queries.map((q, index) =>
      onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (failed) return;
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
          cached[index] = snapshot.metadata.fromCache;
          if (ready.every(Boolean)) {
            if (changes.length || firstSnapshot) {
              const combined = new Map<string, Lead>();
              records.forEach((group) =>
                group.forEach((lead, id) => combined.set(id, lead)),
              );
              combinedLeads = [...combined.values()];
            }
            setResult({
              userId,
              scope,
              leads: combinedLeads,
              error: "",
              cached: cached.some(Boolean),
            });
          }
        },
        () => {
          failed = true;
          // Do not retain records after a permission failure or ownership change.
          setResult({
            userId,
            scope,
            leads: [],
            error:
              "Live lead updates are unavailable. Check your connection and account access.",
            cached: true,
          });
        },
      ),
    );
    return () => {
      failed = true;
      cleanups.forEach((unsubscribe) => unsubscribe());
    };
  }, [userId, role, scope]);
  if (userId && !db)
    return {
      userId,
      leads: [],
      error: "Firebase is not configured for this build.",
      cached: true,
    };
  return result?.scope === scope ? result : null;
}
