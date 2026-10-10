"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  MobileHeader,
  MobileLoading,
  MobileNav,
  MobileNotice,
} from "../_components/MobileShell";
import { FollowUpsView } from "../_components/MobileViews";
import { useDeviceNow } from "../_components/useDeviceNow";
import { useMobileData } from "../_components/useMobileData";
const LeadDetail = dynamic(() => import("@/app/components/LeadDetail"), {
  ssr: false,
});

export default function FollowUpsPage() {
  const router = useRouter();
  const now = useDeviceNow();
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
  } = useMobileData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (loading) return <MobileLoading />;
  const selected = leads.find((l) => l.id === selectedId);
  return (
    <div className="rm-shell">
      <MobileHeader name={user?.name} />
      {error && <MobileNotice>{error}</MobileNotice>}
      {dataLoading || dataUnavailable ? (
        <main className="rm-content">
          <h1 className="rm-page-heading">Follow-ups</h1>
          <p className="rm-data-loading" role="status">
            {dataUnavailable
              ? "Activity is unavailable. Check your connection and account access."
              : "Loading your activity…"}
          </p>
        </main>
      ) : (
        <FollowUpsView
          leads={followUps}
          now={now}
          onLead={(lead) => setSelectedId(lead.id)}
          onNavigate={router.push}
        />
      )}

      <MobileNav />
      {selected && user && (
        <LeadDetail
          key={selected.id}
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
