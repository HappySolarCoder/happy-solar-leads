"use client";
import { useState, useMemo } from "react";
import { ArrowUpRight, Radio, Sun } from "lucide-react";
import Link from "next/link";
import type { Lead } from "@/app/types";
import type { FieldObservation } from "./types";
import { useOptionalMobileData } from "@/app/mobile/_components/MobileDataProvider";
import { scoreDoor, fieldEvents, contactWindows, streetKey } from "./analysis";
import HomeownerView from "./HomeownerView";
import RecoveryCard from "./RecoveryCard";
export type VisitDraft = Pick<
  FieldObservation,
  | "answered"
  | "conversation"
  | "openerId"
  | "objections"
  | "previewShown"
  | "proofShown"
>;
export default function FieldDoorPanel({
  lead,
  draft,
  onChange,
  onHandoff,
}: {
  lead: Lead;
  draft: VisitDraft;
  onChange: (v: VisitDraft) => void;
  onHandoff: () => void;
}) {
  const data = useOptionalMobileData();
  const [present, setPresent] = useState(false);
  const timing = useMemo(() => {
    if (!data?.field.flags.timing) return null;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const street = data.leads.filter(l => streetKey(l) === streetKey(lead));
    return contactWindows(lead, fieldEvents(street, data.dispositions, zone), data.field.config, new Date(), zone).find(w => w.confidence === 'observed') || null;
  }, [data?.field.flags.timing, data?.field.config, data?.leads, data?.dispositions, lead]);
  if (!data?.field.flags.capture) return null;
  const { field } = data,
    score = scoreDoor(lead),
    pending = field.drafts.filter((m) => m.leadId === lead.id);
  return (
    <section className="rf-door">
      {pending.length > 0 && (
        <Link className="rf-sync-status" href="/mobile/field-tools?tab=sync">
          {pending.some((x) => x.blocked)
            ? "Sync needs review"
            : `${pending.length} ${pending.length === 1 ? "change" : "changes"} saved on this device; awaiting sync`}{" "}
          <ArrowUpRight size={14} />
        </Link>
      )}
      <details>
        <summary>
          <Radio size={17} />
          <strong>Conversation tools</strong>
          {field.flags.scoring && (
            <span>
              {score.excluded
                ? "Excluded"
                : score.known
                  ? `${score.score} fit`
                  : "Fit unknown"}
            </span>
          )}
        </summary>
        {field.flags.scoring && (
          <p className="rf-caption">
            {score.reasons.join(" · ")}. Fit is a rules-based priority, not a
            chance of booking.
          </p>
        )}
        {field.flags.timing && <p className="rf-caption">{timing ? `Observed street window: ${timing.start}:00–${timing.end}:00 · ${timing.answers}/${timing.attempts} answers. This is not an occupancy guarantee.` : 'Street timing is still learning. Use a different time window for a spaced not-home return.'}</p>}
        <fieldset>
          <legend>
            Did someone answer? <small>Optional</small>
          </legend>
          <div className="rf-chips">
            {[
              [true, "Yes"],
              [false, "No"],
              [undefined, "Unknown"],
            ].map(([v, label]) => (
              <button
                key={String(label)}
                type="button"
                aria-pressed={draft.answered === v}
                onClick={() =>
                  onChange({
                    ...draft,
                    answered: v as boolean | undefined,
                    conversation: undefined,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {draft.answered && (
          <fieldset>
            <legend>Conversation length</legend>
            <div className="rf-chips">
              {(["short", "45s-plus"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={draft.conversation === v}
                  onClick={() =>
                    onChange({
                      ...draft,
                      conversation: draft.conversation === v ? undefined : v,
                    })
                  }
                >
                  {v === "short" ? "Under 45 sec" : "45 sec or more"}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {field.flags.pitch && field.config.openers.length > 0 && (
          <fieldset>
            <legend>Opener used</legend>
            <div className="rf-chips">
              {field.config.openers.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  aria-pressed={draft.openerId === o.id}
                  onClick={() =>
                    onChange({
                      ...draft,
                      openerId: draft.openerId === o.id ? undefined : o.id,
                    })
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            {field.config.openers.find((o) => o.id === draft.openerId)
              ?.approvedTip && (
              <p>
                {
                  field.config.openers.find((o) => o.id === draft.openerId)
                    ?.approvedTip
                }
              </p>
            )}
          </fieldset>
        )}
        {(field.flags.preview || field.flags.proof) && (
          <button
            type="button"
            className="rf-button"
            onClick={() => setPresent(true)}
          >
            <Sun size={17} />
            Show homeowner preview
          </button>
        )}
        {field.flags.recovery && <RecoveryCard lead={lead} />}
        <p className="rf-caption">
          Saved with your next disposition. Leaving these blank keeps them
          unknown.
        </p>
      </details>
      {field.flags.show && lead.fieldHandoff && (
        <p className="rf-caption">
          Scheduling handoff: <b>{lead.fieldHandoff.state}</b>
          {lead.fieldHandoff.state === "sent"
            ? " · awaiting manager acknowledgement"
            : ""}
        </p>
      )}
      {present && (
        <HomeownerView
          lead={lead}
          config={field.config}
          flags={field.flags}
          onClose={() => setPresent(false)}
          onShown={(kind) =>
            onChange({
              ...draft,
              [kind === "preview" ? "previewShown" : "proofShown"]: true,
            })
          }
          onHandoff={() => {
            setPresent(false);
            onHandoff();
          }}
        />
      )}
    </section>
  );
}
