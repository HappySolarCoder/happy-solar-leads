"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "./_components/MobileShell";
import { TodayView } from "./_components/MobileViews";
import { useDeviceNow } from "./_components/useDeviceNow";
import { useMobileData } from "./_components/useMobileData";
import { personalOutcomeLeads } from "./_lib/fieldUpdates";
import { dayStart, summarizeActivity } from "./_lib/metrics";
import { countWorkdaysElapsedAndRemaining } from '@/app/utils/goals';

const LeadDetail = dynamic(() => import("@/app/components/LeadDetail"), {
  ssr: false,
});

export default function MobilePage() {
  const router = useRouter();
  const {
    user,
    leads,
    dispositions,
    followUps,
    loading,
    dataLoading,
    dataUnavailable,
    error,
    refresh,
    retry,
  } = useMobileData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goal, setGoal] = useState<{ loading: boolean; target: number | null }>(
    { loading: true, target: null }
  );
  const now = useDeviceNow();
  const localDay = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadGoal() {
      const now = new Date();
      try {
        const {
          getMyGoalViaApiAsync,
        } = await import("@/app/utils/goals");
        const monthlyGoal = await getMyGoalViaApiAsync(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
              2,
              "0"
            )}`
        );
        if (active)
          setGoal({
            loading: false,
            target: monthlyGoal?.doorKnocksGoal ?? null,
          });
      } catch {
        if (active) setGoal({ loading: false, target: null });
      }
    }
    void loadGoal();
    return () => {
      active = false;
    };
  }, [user, localDay]);
  // Reuse the live feed. A second getLeadsAsync() fetched the whole collection
  // for admins and reloaded the profile before this screen could show its goal.
  const dailyTarget = useMemo(() => {
    if (!user || !goal.target) return null;
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const knocks = summarizeActivity(leads, user.id, dispositions, month, nextMonth).knocks;
    const remaining = Math.max(1, countWorkdaysElapsedAndRemaining(now).remaining);
    return Math.ceil(Math.max(0, goal.target - knocks) / remaining);
  }, [user, leads, dispositions, goal.target, now]);
  if (loading) return <MobileLoading />;
  if (!user)
    return (
      <MobileNotice>
        {error || "Sign in to open your workspace."}
        {error && <button onClick={retry}>Try again</button>}
      </MobileNotice>
    );
  const selected = leads.find((l) => l.id === selectedId);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (
    <div className="rm-shell">
      <MobileHeader name={user.name} />
      {error && <MobileNotice>{error}{dataUnavailable && <button className="ml-2 underline font-semibold" onClick={() => void refresh()}>Retry data</button>}</MobileNotice>}
      <TodayView
        canManageTerritories={user.role === "admin" || user.role === "manager"}
        liveNavigation
        dataLoading={dataLoading}
        dataUnavailable={dataUnavailable}
        userId={user.id}
        name={user.name}
        now={now}
        metrics={summarizeActivity(
          leads,
          user.id,
          dispositions,
          dayStart(now),
          end
        )}
        followUps={followUps}
        outcomeLeads={personalOutcomeLeads(leads, user.id)}
        dailyTarget={dailyTarget}
        goalLoading={goal.loading}
        onNavigate={router.push}
        onLead={(lead) => setSelectedId(lead.id)}
      />
      <MobileNav />
      {selected && (
        <LeadDetail
          key={selectedId}
          fieldMemory
          dispositionOptions={dispositions}
          dispositionsLoading={dataLoading}
          lead={selected}
          currentUser={user}
          onClose={() => setSelectedId(null)}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}
