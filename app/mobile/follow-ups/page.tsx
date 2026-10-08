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
import { useMobileData } from "../_components/useMobileData";
const LeadDetail = dynamic(() => import("@/app/components/LeadDetail"), {
  ssr: false,
});

export default function FollowUpsPage() {
  const router = useRouter();
  const { user, leads, followUps, loading, error, refresh } = useMobileData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (loading) return <MobileLoading />;
  const selected = leads.find((l) => l.id === selectedId);
  return (
    <div className="rm-shell">
      <MobileHeader name={user?.name} />
      {error && <MobileNotice>{error}</MobileNotice>}
      <FollowUpsView
        leads={followUps}
        now={new Date()}
        onLead={(lead) => setSelectedId(lead.id)}
        onNavigate={router.push}
      />
      <MobileNav />
      {selected && user && (
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
