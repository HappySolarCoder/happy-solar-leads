import type { Lead } from "@/app/types";
import { getAppointmentOutcome } from "@/app/utils/appointmentOutcome";

export function AppointmentOutcomeBadge({ lead }: { lead: Lead }) {
  const outcome = getAppointmentOutcome(lead);
  if (!outcome) return null;
  return (
    <span
      className="rm-outcome-badge"
      style={{ color: outcome.color, background: outcome.background }}
    >
      <span aria-hidden="true">{outcome.symbol}</span>
      {outcome.label}
    </span>
  );
}

export default function AppointmentOutcomeCard({ lead }: { lead: Lead }) {
  if (lead.historicalTerritoryPin) return null;
  const outcome = getAppointmentOutcome(lead);
  if (!outcome && !lead.ghlOpportunityId && lead.status !== "appointment")
    return null;
  const updated = lead.ghlLastUpdatedAt
    ? new Date(lead.ghlLastUpdatedAt)
    : null;
  return (
    <section
      className="rm-outcome"
      aria-label="Appointment outcome"
      aria-live="polite"
    >
      <div className="rm-outcome-top">
        <strong>Appointment outcome</strong>
        <span>GHL</span>
      </div>
      {outcome ? (
        <AppointmentOutcomeBadge lead={lead} />
      ) : (
        <strong className="text-sm text-slate-600">Awaiting an outcome</strong>
      )}
      {lead.ghlStatus && <p>Pipeline stage: {lead.ghlStatus}</p>}
      {updated && Number.isFinite(updated.getTime()) && (
        <p>
          Source updated{" "}
          {updated.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      )}
      <p>
        {outcome
          ? "Synced appointment result. Your door-knock disposition is unchanged."
          : "The result will appear here when it is synced from GHL."}
      </p>
    </section>
  );
}
