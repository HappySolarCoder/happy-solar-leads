"use client";

import { useEffect, useState } from "react";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";
import { canSeeHotLeads } from "@/app/hotLeads/access";
import { fetchHotLeadDetail, fetchHotLeadMap, type HotView } from "@/app/hotLeads/fetch";
import { HOT_LEADS_ENABLED } from "@/app/hotLeads/flag";
import {
  bindHotPins,
  publishHotCapabilities,
  type HotCapabilities,
  type HotLeadPin,
} from "@/app/hotLeads/model";
import type { User } from "@/app/types";

const EMPTY_CAPS: HotCapabilities = { dispo: false, claim: false };

/**
 * Hot pins only. A failure here is silent: no toast, no "Sign in again",
 * and this hook never touches the lead viewport cache.
 */
export function useHotLeads(user: User | null, view: HotView | null, active = true) {
  const allowed = active && HOT_LEADS_ENABLED && canSeeHotLeads(user);
  const key = view
    ? [view.south, view.north, view.west, view.east, view.zoom].map((n) => n.toFixed(5)).join(":")
    : "";
  const [pins, setPins] = useState<HotLeadPin[]>([]);
  const [capabilities, setCapabilities] = useState<HotCapabilities>(EMPTY_CAPS);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    return bindHotPins((next) => setPins(next));
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const person = user;
    const bounds = view;
    if (!allowed || !person || !bounds) {
      publishHotCapabilities(EMPTY_CAPS);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const token = await auth?.currentUser?.getIdToken().catch(() => "");
        if (!alive || !token || auth?.currentUser?.uid !== person.id) return;
        const result = await fetchHotLeadMap({
          user: person,
          view: bounds,
          token,
          fetcher: (url, init) => apiFetch(url, { headers: init.headers }),
        });
        if (!alive || auth?.currentUser?.uid !== person.id) return;
        setPins(result.pins);
        setCapabilities(result.capabilities);
        publishHotCapabilities(result.capabilities);
      })();
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [active, allowed, user, view, key, attempt]);

  useEffect(() => {
    if (!allowed) return;
    const online = () => setAttempt((value) => value + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [allowed]);

  async function loadOne(id: string): Promise<HotLeadPin | null> {
    if (!allowed || !user) return null;
    const token = await auth?.currentUser?.getIdToken().catch(() => "");
    if (!token || auth?.currentUser?.uid !== user.id) return null;
    const result = await fetchHotLeadDetail({
      user,
      id,
      token,
      fetcher: (url, init) => apiFetch(url, { headers: init.headers }),
    });
    return result.hotLead;
  }

  const visible = allowed && !!view;
  return {
    pins: visible ? pins : [],
    capabilities: visible ? capabilities : EMPTY_CAPS,
    error: "" as const,
    loadOne,
  };
}
