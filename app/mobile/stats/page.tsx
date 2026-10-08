"use client";

import { useRouter } from "next/navigation";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "../_components/MobileShell";
import { ProgressView } from "../_components/MobileViews";
import { useMobileData } from "../_components/useMobileData";
import { dayStart, summarizeActivity } from "../_lib/metrics";

export default function MobileStatsPage() {
  const router = useRouter();
  const { user, leads, dispositions, loading, error } = useMobileData();
  if (loading) return <MobileLoading />;
  if (!user)
    return (
      <MobileNotice>{error || "Sign in to see your progress."}</MobileNotice>
    );
  const now = new Date();
  const today = dayStart(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const summarize = (from: Date, until = end) =>
    summarizeActivity(leads, user.id, dispositions, from, until);
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
      <ProgressView
        today={summarize(today)}
        week={summarize(monday)}
        month={summarize(new Date(now.getFullYear(), now.getMonth(), 1))}
        days={days}
        onNavigate={router.push}
      />
      <MobileNav />
    </div>
  );
}
