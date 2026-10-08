"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentAuthUser } from "@/app/utils/auth";
import { useLiveLeads } from "@/app/hooks/useLiveLeads";
import {
  getDispositionsAsync,
  isScheduledGoBackLead,
} from "@/app/utils/dispositions";
import { canSeeAllLeads, type User } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";

export function useMobileData() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const current = await getCurrentAuthUser();
        if (!active) return;
        if (!current) {
          router.replace("/login");
          return;
        }
        if (current.approvalStatus === "pending") {
          router.replace("/pending-approval");
          return;
        }
        setUser(current);
        const statuses = await getDispositionsAsync();
        if (active) {
          setDispositions(statuses);
          setLoading(false);
        }
      } catch {
        if (active) {
          setError(
            "Your activity could not be loaded. Check your connection and try again.",
          );
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [router]);

  // Firestore snapshots deliver writes automatically; no cached re-fetch after saves.
  const refresh = useCallback(async () => {}, []);
  const live = useLiveLeads(user);
  const visibleLeads = live?.leads || [];
  const followUps = user
    ? visibleLeads.filter(
        (lead) =>
          isScheduledGoBackLead(lead) &&
          (canSeeAllLeads(user.role) ||
            lead.claimedBy === user.id ||
            lead.goBackScheduledBy === user.id),
      )
    : [];

  return {
    user,
    leads: visibleLeads,
    dispositions,
    followUps,
    loading: loading || (!!user && !live),
    error:
      error ||
      live?.error ||
      (live?.cached
        ? "Showing cached leads. Appointment outcomes may be out of date until you reconnect."
        : ""),
    refresh,
  };
}
