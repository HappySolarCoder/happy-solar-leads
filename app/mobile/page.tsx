"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "./_components/MobileShell";
import { TodayView } from "./_components/MobileViews";
import { useMobileData } from "./_components/useMobileData";
import { getAppointmentOutcome } from "@/app/utils/appointmentOutcome";
import { dayStart, summarizeActivity } from "./_lib/metrics";

const LeadDetail = dynamic(() => import("@/app/components/LeadDetail"), {
  ssr: false,
});

export default function MobilePage() {
  const router = useRouter();
  const { user, leads, dispositions, followUps, loading, error, refresh } =
    useMobileData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [goal, setGoal] = useState<{ loading: boolean; target: number | null }>(
    { loading: true, target: null },
  );
  const [now] = useState(() => new Date());
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadGoal() {
      try {
        const {
          getMyGoalViaApiAsync,
          getMyMonthlyKnocksAsync,
          countWorkdaysElapsedAndRemaining,
        } = await import("@/app/utils/goals");
        const [monthlyGoal, knocks] = await Promise.all([
          getMyGoalViaApiAsync(
            `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
          ),
          getMyMonthlyKnocksAsync(now, user!),
        ]);
        const remaining = Math.max(
          1,
          countWorkdaysElapsedAndRemaining(now).remaining,
        );
        if (active)
          setGoal({
            loading: false,
            target: monthlyGoal?.doorKnocksGoal
              ? Math.ceil(
                  Math.max(0, Number(monthlyGoal.doorKnocksGoal) - knocks) /
                    remaining,
                )
              : null,
          });
      } catch {
        if (active) setGoal({ loading: false, target: null });
      }
    }
    void loadGoal();
    return () => {
      active = false;
    };
  }, [user, now]);
  if (loading) return <MobileLoading />;
  if (!user)
    return (
      <MobileNotice>{error || "Sign in to open your workspace."}</MobileNotice>
    );
  const selected = leads.find((l) => l.id === selectedId);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return (
    <div className="rm-shell">
      <MobileHeader name={user.name} />
      {error && <MobileNotice>{error}</MobileNotice>}
      <TodayView
        name={user.name}
        now={now}
        metrics={summarizeActivity(
          leads,
          user.id,
          dispositions,
          dayStart(now),
          end,
        )}
        followUps={followUps}
        outcomeLeads={leads
          .filter((l) => getAppointmentOutcome(l))
          .sort(
            (a, b) =>
              (new Date(b.ghlLastUpdatedAt || 0).getTime() || 0) -
              (new Date(a.ghlLastUpdatedAt || 0).getTime() || 0),
          )}
        dailyTarget={goal.target}
        goalLoading={goal.loading}
        onNavigate={router.push}
        onLead={(lead) => setSelectedId(lead.id)}
      />
      <MobileNav />
      {selected && (
        <LeadDetail
          lead={selected}
          currentUser={user}
          onClose={() => setSelectedId(null)}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}
