"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ChevronDown, ChevronUp, Users, X } from "lucide-react";
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/app/utils/firebase";
import { getCurrentAuthUser } from "@/app/utils/auth";
import { getLeadsAsync } from "@/app/utils/storage";
import { canSeeTeamData, type Lead, type User } from "@/app/types";
import { isKnockStatus } from "@/app/types/disposition";
import { useOptionalMobileData } from "@/app/mobile/_components/MobileDataProvider";
import { useDeviceNow } from "@/app/mobile/_components/useDeviceNow";
import type { TeamMember } from "@/app/components/TeamMapView";

const TeamMap = dynamic(() => import("@/app/components/TeamMapView"), {
  ssr: false,
  loading: () => (
    <div role="status" className="p-6 text-[#476b83]">
      Loading team map…
    </div>
  ),
});
type TimeFilter = "today" | "yesterday" | "last7days" | "all";

export default function TeamMapPage() {
  const shared = useOptionalMobileData();
  const hasShared = !!shared;
  const [fallback, setFallback] = useState<{
    user: User | null;
    leads: Lead[];
  }>({ user: null, leads: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [capped, setCapped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<TimeFilter>("today");
  const now = useDeviceNow();
  const user = shared?.user || fallback.user;
  const leads = shared?.leads || fallback.leads;
  const allowed = !!user && canSeeTeamData(user.role);

  // The installed app reuses its existing lead subscription. Legacy web entry
  // retains its existing cache, without adding a second mobile collection read.
  useEffect(() => {
    if (hasShared) return;
    let alive = true;
    void getCurrentAuthUser()
      .then(async (account) => {
        if (!alive) return;
        setFallback({ user: account, leads: [] });
        setReady(true);
        if (account && canSeeTeamData(account.role)) {
          const data = await getLeadsAsync();
          if (alive) setFallback({ user: account, leads: data });
        }
      })
      .catch(() => {
        if (alive) {
          setReady(true);
          setError(
            "Team data is unavailable. Check your connection and try again.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [hasShared]);

  useEffect(() => {
    if (!allowed || !db) return;
    // Only while this screen is open; retain the existing active-user listener,
    // now bounded, and never load the homeowners collection here.
    return onSnapshot(
      query(collection(db, "users"), where("isActive", "==", true), limit(500)),
      (snapshot) => {
        setError("");
        setCapped(snapshot.size === 500);
        const next: TeamMember[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data(),
            location = data.currentLocation;
          const timestamp =
            location?.timestamp?.toDate?.() ||
            (location?.timestamp ? new Date(location.timestamp) : null);
          if (
            !Number.isFinite(location?.lat) ||
            !Number.isFinite(location?.lng) ||
            Math.abs(location.lat) > 90 ||
            Math.abs(location.lng) > 180 ||
            !timestamp ||
            !Number.isFinite(timestamp.getTime())
          )
            return;
          next.push({
            id: doc.id,
            name: data.name || "Team member",
            color: /^#[\da-f]{6}$/i.test(data.color) ? data.color : "#52738e",
            lat: location.lat,
            lng: location.lng,
            lastUpdate: timestamp,
            status: data.status || "In field",
          });
        });
        setMembers(next);
      },
      () =>
        setError(
          "Recent team locations are unavailable. Check your connection or account access.",
        ),
    );
  }, [allowed, user?.id]);

  const active = useMemo(
    () =>
      members.filter(
        (member) => now.getTime() - member.lastUpdate.getTime() <= 30 * 60000,
      ),
    [members, now],
  );
  const selected = active.find((member) => member.id === selectedId);
  const stats = useMemo(() => {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = midnight.getTime(),
      end = Infinity;
    if (filter === "yesterday") {
      end = start;
      start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
      ).getTime();
    }
    if (filter === "last7days")
      start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 6,
      ).getTime();
    if (filter === "all") start = 0;
    const result = new Map<string, { doors: number; appointments: number }>();
    for (const lead of leads) {
      if (!lead.claimedBy || !lead.dispositionedAt) continue;
      const at = new Date(lead.dispositionedAt).getTime();
      if (!Number.isFinite(at) || at < start || at >= end) continue;
      const count = result.get(lead.claimedBy) || { doors: 0, appointments: 0 };
      if (isKnockStatus(lead.status)) count.doors++;
      if (lead.status === "appointment" || lead.status === "sale")
        count.appointments++;
      result.set(lead.claimedBy, count);
    }
    return result;
  }, [leads, filter, now]);

  if (!hasShared && !ready)
    return (
      <main
        role="status"
        className="min-h-screen grid place-items-center text-[#476b83]"
      >
        Loading team map…
      </main>
    );
  if (!allowed)
    return (
      <main className="p-6 space-y-4">
        <h1 className="text-xl font-bold">Team map</h1>
        <p>{error || "Team locations are available to managers and admins."}</p>
        <Link href="/mobile/more">Back to workspace</Link>
      </main>
    );
  return (
    <main
      className="relative flex flex-col overflow-hidden bg-[#fffcf5] text-[#30445c]"
      style={{ height: "100dvh" }}
    >
      <header
        className="relative z-20 shrink-0 border-b border-[#d8e1e8] bg-[#fffcf5] px-4 pb-3"
        style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/mobile/more"
            aria-label="Back to workspace"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eaf0f4]"
          >
            <ArrowLeft size={21} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">Team map</h1>
            <p className="text-xs text-[#65778a]">
              {active.length} recent locations · last 30 minutes
            </p>
          </div>
          <button
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? "Hide team list" : "Show team list"}
            className="grid h-11 w-11 place-items-center rounded-xl bg-[#eaf0f4]"
          >
            <Users size={21} />
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-amber-800">
            {error}
          </p>
        )}
        {capped && (
          <p className="mt-2 text-xs">Showing up to 500 active accounts.</p>
        )}
      </header>
      <div className="relative min-h-0 flex-1 isolate">
        <TeamMap
          teamMembers={active}
          onMemberClick={(member) => {
            setSelectedId(member.id);
            setExpanded(true);
          }}
        />
      </div>
      <section
        aria-label="Team activity"
        className="absolute bottom-0 left-0 right-0 z-30 rounded-t-3xl border border-[#d8e1e8] bg-[#fffcf5] shadow-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-12 w-full items-center justify-center gap-2 text-sm font-semibold"
          aria-expanded={expanded}
        >
          {selected ? selected.name : "Team activity"}{" "}
          {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
        {expanded && (
          <div className="max-h-[38dvh] overflow-y-auto overscroll-contain px-4 pb-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <label className="text-xs text-[#65778a]">
                Loaded pin activity{" "}
                <select
                  aria-label="Team activity period"
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as TimeFilter)
                  }
                  className="ml-2 rounded-lg border border-[#d8e1e8] bg-white p-2 text-[#30445c]"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7days">7 days</option>
                  <option value="all">All loaded</option>
                </select>
              </label>
              {selected && (
                <button
                  data-raydar-back-close
                  aria-label="Back to team list"
                  onClick={() => setSelectedId(null)}
                  className="grid h-11 w-11 place-items-center"
                >
                  <X size={20} />
                </button>
              )}
            </div>
            {active.length === 0 && (
              <p className="py-5 text-center text-sm text-[#65778a]">
                No recent shared locations. Reps appear here when their location
                updates.
              </p>
            )}
            {(selected ? [selected] : active).map((member) => {
              const count = stats.get(member.id) || {
                doors: 0,
                appointments: 0,
              };
              return (
                <button
                  key={member.id}
                  onClick={() => setSelectedId(member.id)}
                  className="flex w-full items-center gap-3 rounded-xl bg-[#eaf0f4] p-3 mb-2 text-left"
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-bold text-white"
                    style={{ backgroundColor: member.color }}
                  >
                    {member.name.charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate">{member.name}</strong>
                    <small className="block text-[#65778a]">
                      {count.doors} doors · {count.appointments} appointments
                    </small>
                    <small className="block text-[#65778a]">
                      Updated{" "}
                      {Math.max(
                        0,
                        Math.floor(
                          (now.getTime() - member.lastUpdate.getTime()) / 60000,
                        ),
                      )}{" "}
                      min ago
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
