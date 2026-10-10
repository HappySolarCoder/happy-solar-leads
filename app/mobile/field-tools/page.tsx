"use client";
import { useState } from "react";
import type { Lead } from "@/app/types";
import LeadDetail from "@/app/components/LeadDetail";
import FieldWorkspace from "@/app/field/FieldWorkspace";
import { useMobileData } from "../_components/MobileDataProvider";
import { useDeviceNow } from "../_components/useDeviceNow";
import { MobileLoading } from "../_components/MobileShell";
export default function FieldToolsPage() {
  const data = useMobileData(),
    now = useDeviceNow(),
    [selected, setSelected] = useState<Lead | null>(null);
  if (!data.user) return <MobileLoading />;
  const { user, field } = data;
  return (
    <>
      <FieldWorkspace
        user={user}
        leads={data.leads}
        dispositions={data.dispositions}
        config={field.config}
        flags={field.flags}
        now={now}
        offline={field.offline}
        drafts={field.drafts}
        syncing={field.syncing}
        error={field.error}
        prepared={field.area?.at}
        onSelect={setSelected}
        onPrepare={field.prepare}
        onSync={field.sync}
        onDiscard={field.discard}
        onHandoff={async (lead, state) => {
          await field.enqueue({
            id: crypto.randomUUID(),
            userId: user.id,
            leadId: lead.id,
            createdAt: new Date().toISOString(),
            kind: "handoff",
            baseStatus: lead.status,
            handoff: state,
          });
        }}
      />
      {selected && (
        <LeadDetail
          key={selected.id}
          lead={selected}
          currentUser={user}
          fieldMemory
          dispositionOptions={data.dispositions}
          onClose={() => setSelected(null)}
          onUpdate={() => {}}
        />
      )}
    </>
  );
}
