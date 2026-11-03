"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "../_components/MobileShell";
import { ProgressView } from "../_components/MobileViews";
import { useDeviceNow } from "../_components/useDeviceNow";
import { useMobileData } from "../_components/useMobileData";
import { assembleKnockLeads } from "../_lib/knockSources";
import { dayStart, summarizeActivity } from "../_lib/metrics";
import { HOT_LEADS_ENABLED } from "@/app/hotLeads/flag";
import { loadedHotPins } from "@/app/hotLeads/model";

export default function MobileStatsPage() {
  const router = useRouter();
  const now = useDeviceNow();
  const {
    user,
    leads,
    field,
    dispositions,
    knockLedger,
    hotTick,
    loading,
    dataLoading,
    dataUnavailable,
    error,
  } = useMobileData();
  const knockSet = useMemo(
    () =>
      assembleKnockLeads({
        leads,
        hotPins: HOT_LEADS_ENABLED ? loadedHotPins() : [],
        hotDrafts: HOT_LEADS_ENABLED ? field.drafts : [],
      }),
    [leads, field.drafts, hotTick],
  );
  if (loading) return <MobileLoading />;
  if (!user)
    return (
      <MobileNotice>{error || "Sign in to see your progress."}</MobileNotice>
    );
  const today = dayStart(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const summarize = (from: Date, until = end) =>
    summarizeActivity(leads, user.id, dispositions, from, until, {
      ledger: knockLedger,
      knockSources: knockSet.leads,
      leadAliases: knockSet.aliases,
    });
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - 6 + index);
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return {
      label: date.toLocaleDateString("en-US", { weekday: "short" }),
      fullLabel: date.toDateString(),
      knocks: summarize(date, next).knocks,
    };
  });
  return (
    <div className="rm-shell">
      <MobileHeader name={user.name} />
      {error && <MobileNotice>{error}</MobileNotice>}
      {dataLoading || dataUnavailable ? (
        <main className="rm-content">
          <h1 className="rm-page-heading">Your progress</h1>
          <p className="rm-data-loading" role="status">
            {dataUnavailable
              ? "Activity is unavailable. Check your connection and account access."
              : "Loading your activity…"}
          </p>
        </main>
      ) : (
        <ProgressView
          today={summarize(today)}
          week={summarize(monday)}
          month={summarize(new Date(now.getFullYear(), now.getMonth(), 1))}
          days={days}
          onNavigate={router.push}
        />
      )}

      <MobileNav />
    </div>
  );
}
