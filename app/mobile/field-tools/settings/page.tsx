"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { useMobileData } from "../../_components/MobileDataProvider";
import {
  MobileHeader,
  MobileNav,
  MobileLoading,
} from "../../_components/MobileShell";
import { FEATURE_KEYS, type FieldConfig } from "@/app/field/types";
import { fieldRequest } from "@/app/field/useFieldData";
import { cleanConfig } from "@/app/field/config";
const labels = {
  capture: [
    "Visit observations",
    "Answer, conversation, GPS and safe queued notes",
  ],
  scoring: ["Solar fit", "Rules from recorded roof and ownership data"],
  timing: [
    "Street timing + return sweeps",
    "Spaced not-home returns and observed answer windows",
  ],
  preview: ["Savings preview", "Requires approved state-specific assumptions"],
  proof: ["Local proof", "Only approved examples with sharing permission"],
  pitch: [
    "Pitch observations",
    "Manager-approved openers and outcome comparisons",
  ],
  recovery: [
    "Recovery cards",
    "Requires public backend activation; no automated texts",
  ],
  show: [
    "Scheduling handoffs",
    "Sent, acknowledged and closed; bookings stay with GHL",
  ],
  coaching: [
    "Personal insights",
    "One suggestion from the rep’s recorded sample",
  ],
};
export default function FieldSettings() {
  const data = useMobileData();
  if (!data.user) return <MobileLoading />;
  if (data.user.role !== "admin")
    return (
      <main className="rm-content">
        <Link href="/mobile/field-tools">Back to field tools</Link>
        <p>Only an admin can change pilot settings.</p>
      </main>
    );
  if (!data.field.ready)
    return (
      <main className="rm-content">
        <Link href="/mobile/field-tools">Back to field tools</Link>
        <h1>Field settings unavailable</h1>
        <p>{data.field.error || "Loading settings…"}</p>
        <button
          className="rf-button"
          onClick={() => void data.field.loadConfig()}
        >
          Retry
        </button>
      </main>
    );
  return (
    <Editor
      key={data.field.config.version}
      config={data.field.config}
      userId={data.user.id}
      name={data.user.name}
      onSaved={data.field.loadConfig}
    />
  );
}
function Editor({
  config,
  userId,
  name,
  onSaved,
}: {
  config: FieldConfig;
  userId: string;
  name: string;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(config),
    [advanced, setAdvanced] = useState(
      JSON.stringify(
        {
          openers: config.openers,
          proof: config.proof,
          savings: config.savings,
        },
        null,
        2,
      ),
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const change = <K extends keyof FieldConfig>(key: K, value: FieldConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const extra = JSON.parse(advanced);
      if (extra.savings && !cleanConfig({ savings: extra.savings }).savings)
        throw Error(
          "Savings assumptions are incomplete or invalid. See FIELD-V11.md for the schema.",
        );
      if (!Array.isArray(extra.openers) || !Array.isArray(extra.proof))
        throw Error("Openers and proof must be lists.");
      await fieldRequest("/api/field-config", {
        version: config.version,
        config: {
          ...draft,
          openers: extra.openers,
          proof: extra.proof,
          savings: extra.savings,
        },
      });
      await onSaved();
      setMessage("Pilot settings saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rm-shell">
      <MobileHeader name={name} />
      <main className="rm-content rf-content">
        <Link href="/mobile/field-tools" className="rm-back">
          <ArrowLeft size={16} />
          Field tools
        </Link>
        <span className="rf-kicker">ADMIN CONTROLS</span>
        <h1>A measured rollout.</h1>
        <p>
          Start with selected FMAs. Capture is shared by pilot and control reps
          so the comparison has the same observations.
        </p>
        <div className="rf-card">
          <label>
            Experiment name
            <input
              value={draft.experiment}
              maxLength={60}
              onChange={(e) => change("experiment", e.target.value)}
            />
          </label>
          <label>
            Pilot percentage
            <input
              type="number"
              min={0}
              max={100}
              value={draft.pilotPercent}
              onChange={(e) => change("pilotPercent", Number(e.target.value))}
            />
          </label>
          <label>
            Eligible Firebase user IDs · one per line
            <textarea
              rows={3}
              value={draft.allowedUsers.join("\n")}
              onChange={(e) =>
                change(
                  "allowedUsers",
                  e.target.value.split(/\s+/).filter(Boolean),
                )
              }
            />
          </label>
          <small>
            Blank means all active users. A stable hash assigns the percentage;
            0 is all control, 100 is all pilot.
          </small>
          <button
            className="rf-button"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                allowedUsers: [userId],
                pilotPercent: 100,
                enabled: {
                  ...d.enabled,
                  capture: true,
                  scoring: true,
                  timing: true,
                  pitch: true,
                  show: true,
                  coaching: true,
                },
              }))
            }
          >
            Prepare a pilot for my account only
          </button>
        </div>
        <section className="rf-card">
          {FEATURE_KEYS.map((key) => (
            <label className="rf-check rf-flag" key={key}>
              <input
                type="checkbox"
                checked={draft.enabled[key]}
                onChange={(e) =>
                  change("enabled", {
                    ...draft.enabled,
                    [key]: e.target.checked,
                  })
                }
              />
              <span>
                <strong>{labels[key][0]}</strong>
                <small>{labels[key][1]}</small>
              </span>
            </label>
          ))}
        </section>
        <section className="rf-card">
          <h2>Return planning</h2>
          <div className="rf-filters">
            {(
              [
                ["startHour", "Start hour", 0, 22],
                ["endHour", "End hour", 1, 24],
                ["maxAttempts", "Max attempts", 1, 5],
                ["minTimingAttempts", "Minimum timing sample", 20, 200],
                ["maxCacheDoors", "Prepared doors", 50, 1000],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={draft[key]}
                  onChange={(e) => change(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <p className="rf-caption">
            Hours use the phone’s timezone and guide suggestions only. Set them
            to your actual permitted canvassing hours. Existing agreed go-backs
            are separate.
          </p>
        </section>
        <section className="rf-card">
          <h2>Recovery card setup</h2>
          <label>
            Public website origin
            <input
              type="url"
              placeholder="https://happy-solar-leads.vercel.app"
              value={draft.publicOrigin}
              onChange={(e) => change("publicOrigin", e.target.value)}
            />
          </label>
          <label>
            Scheduling team phone
            <input
              type="tel"
              value={draft.schedulingPhone}
              onChange={(e) => change("schedulingPhone", e.target.value)}
            />
          </label>
          <p>
            The backend must have a recovery secret, public pages deployed, and
            an edge rate limit before activation. Cards request one callback;
            calendar booking and texts remain in your scheduling system.
          </p>
        </section>
        <section className="rf-card">
          <h2>Approved content</h2>
          <p>
            Import approved openers, proof and finance assumptions as JSON. The
            format is documented in <b>docs/mobile-next/FIELD-V11.md</b>. No
            financial defaults or customer examples are supplied.
          </p>
          <textarea
            aria-label="Approved content JSON"
            rows={14}
            className="rf-code"
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
          />
          <p className="rf-caption">
            Proof requires approval, sharing permission, and a verification
            date. Savings assumptions expire after 180 days and apply to the
            configured state only.
          </p>
        </section>
        {message && (
          <p className="rf-notice" role="status">
            {message}
          </p>
        )}
        <button className="rf-primary" disabled={busy} onClick={save}>
          <Save size={18} />
          {busy ? "Saving…" : "Save pilot settings"}
        </button>
      </main>
      <MobileNav />
    </div>
  );
}
