"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CloudDownload,
  Radio,
  RefreshCw,
  Settings2,
  Target,
} from "lucide-react";
import type { Lead, User } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";
import type {
  FieldConfig,
  FieldEvent,
  FieldFlags,
  PendingMutation,
} from "./types";
import {
  accessibleDoor,
  dailyTip,
  fieldEvents,
  funnel,
  revisitDoors,
  scoreDoor,
  streetKey,
} from "./analysis";
import { getAppointmentOutcome } from "@/app/utils/appointmentOutcome";
import PersonPicker from "@/app/mobile/_components/PersonPicker";
import { MobileHeader, MobileNav } from "@/app/mobile/_components/MobileShell";
const rate = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : "—";
const prettyHour = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
type Props = {
  user: User;
  leads: Lead[];
  dispositions: Disposition[];
  config: FieldConfig;
  flags: FieldFlags;
  now: Date;
  offline: boolean;
  drafts: PendingMutation[];
  syncing: boolean;
  error: string;
  prepared?: number;
  demo?: boolean;
  onSelect: (l: Lead) => void;
  onPrepare: (leads: Lead[]) => Promise<number>;
  onSync: () => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onHandoff: (lead: Lead, state: "acknowledged" | "closed") => Promise<void>;
};
export default function FieldWorkspace(p: Props) {
  const [tab, setTab] = useState(() =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("tab") === "sync"
        ? "sync"
        : "doors",
    ),
    [mode, setMode] = useState("sweep"),
    [search, setSearch] = useState(""),
    [rep, setRep] = useState(p.user.id),
    [period, setPeriod] = useState(7),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [limit, setLimit] = useState(25);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    manager = ["admin", "manager"].includes(p.user.role);
  const events = useMemo(
    () => fieldEvents(p.leads, p.dispositions, zone),
    [p.leads, p.dispositions, zone],
  );
  const windowStart = new Date(p.now);
  windowStart.setDate(windowStart.getDate() - period + 1);
  windowStart.setHours(0, 0, 0, 0);
  const since = windowStart.getTime();
  const recent = useMemo(
    () =>
      events.filter(
        (e) =>
          e.at.getTime() >= since && e.at <= p.now && (!rep || e.repId === rep),
      ),
    [events, since, p.now, rep],
  );
  const summary = useMemo(
    () => funnel(recent, p.leads, p.now),
    [recent, p.leads, p.now],
  );
  const sweeps = useMemo(
    () =>
      p.flags.timing
        ? revisitDoors(p.leads, events, p.config, p.user, p.now, zone)
        : [],
    [p.leads, events, p.config, p.flags.timing, p.user, p.now, zone],
  );
  const ranked = useMemo(
    () =>
      p.flags.scoring
        ? p.leads
            .filter((l) => accessibleDoor(l, p.user))
            .map((lead) => ({ lead, ...scoreDoor(lead) }))
            .filter((x) => !x.excluded)
            .sort((a, b) => b.score - a.score)
        : [],
    [p.leads, p.user, p.flags.scoring],
  );
  const reps = useMemo(() => {
    const m = new Map<string, string>([[p.user.id, p.user.name]]);
    for (const l of p.leads)
      for (const h of l.dispositionHistory || [])
        if (h.userId) m.set(h.userId, h.userName || h.userId);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [p.leads, p.user.id, p.user.name]);
  const repOptions = useMemo(
    () => reps.map(([id, name]) => ({ id, name })),
    [reps],
  );
  const handoffs = p.leads
    .filter(
      (l) =>
        accessibleDoor(l, p.user) &&
        ((l.fieldHandoff &&
          !["closed", "booked"].includes(l.fieldHandoff.state)) ||
          (l.fieldRecovery?.callbackRequested &&
            l.fieldHandoff?.state !== "closed")),
    )
    .sort(
      (a, b) =>
        (Date.parse(
          a.fieldRecovery?.requestedAt || a.fieldHandoff?.sentAt || "",
        ) || 0) -
        (Date.parse(
          b.fieldRecovery?.requestedAt || b.fieldHandoff?.sentAt || "",
        ) || 0),
    );
  const matching = (l: Lead) =>
    `${l.address} ${l.city} ${l.zip}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const rows =
    mode === "sweep"
      ? sweeps.filter((x) => matching(x.lead))
      : ranked.filter((x) => matching(x.lead));
  const selectedStreetGroups = useMemo(() => {
    const groups = new Map<string, typeof sweeps>();
    for (const s of sweeps) {
      const key = streetKey(s.lead),
        a = groups.get(key) || [];
      a.push(s);
      groups.set(key, a);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length);
  }, [sweeps]);
  async function action(fn: () => Promise<unknown>, success = "") {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      if (success) setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function groupedReport(key: (e: FieldEvent) => string) {
    const groups = new Map<string, FieldEvent[]>();
    for (const e of recent) {
      if (!e.knock) continue;
      const k = key(e);
      const group = groups.get(k) || [];
      group.push(e);
      groups.set(k, group);
    }
    return [...groups]
      .map(([name, es]) => ({ name, ...funnel(es, p.leads, p.now) }))
      .sort((a, b) => b.knocks - a.knocks);
  }
  const hourRows =
    tab === "insights"
      ? groupedReport(
          (e) =>
            `${prettyHour(Math.floor(e.localHour / 2) * 2)}–${prettyHour(Math.floor(e.localHour / 2) * 2 + 2)}`,
        )
      : [];
  const openerRows =
    tab === "insights"
      ? groupedReport(
          (e) =>
            p.config.openers.find((o) => o.id === e.openerId)?.label ||
            "Not recorded",
        )
      : [];
  return (
    <div className="rm-shell rf-workspace">
      <MobileHeader name={p.user.name} />
      <main className="rm-content rf-content">
        <div className="rf-topline">
          <Link href="/mobile/more" className="rm-back">
            <ArrowLeft size={16} />
            Workspace
          </Link>
          {p.user.role === "admin" && !p.demo && (
            <Link
              href="/mobile/field-tools/settings"
              className="rf-icon"
              aria-label="Field tool settings"
            >
              <Settings2 size={21} />
            </Link>
          )}
        </div>
        <span className="rf-kicker">YOUR NEXT GOOD CONVERSATION</span>
        <h1>
          Field tools
          <span className="rf-signal">
            <Radio size={23} />
          </span>
        </h1>
        <p className="rf-intro">
          Know where to return. Make the handoff count.
        </p>
        {p.demo && (
          <div className="rf-notice">
            Design preview · fictional data · no changes are saved
          </div>
        )}
        {p.offline && (
          <div className="rf-notice">
            Offline · prepared doors only. Satellite tiles need a connection.
          </div>
        )}
        {(p.error || message) && (
          <p className="rf-notice" role="status">
            {message || p.error}
          </p>
        )}
        {!p.flags.capture && (
          <div className="rf-card">
            <h2>Ready for a field pilot</h2>
            <p>
              Your admin can turn on the tools for selected FMAs. Until then,
              the existing knocking workflow stays available.
            </p>
            {p.user.role === "admin" && (
              <Link className="rf-button" href="/mobile/field-tools/settings">
                Set up the pilot <ArrowUpRight size={16} />
              </Link>
            )}
          </div>
        )}
        <div className="rf-tabs" role="tablist" aria-label="Field tools">
          {[
            ["doors", "Doors"],
            ["insights", "Insights"],
            ["handoffs", "Handoffs"],
            ["sync", `Sync${p.drafts.length ? ` (${p.drafts.length})` : ""}`],
          ].map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => {
                setTab(id);
                setLimit(25);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "doors" && (
          <>
            <div className="rf-feature-card">
              <span className="rf-kicker">RETURN SWEEP</span>
              <h2>
                {p.flags.timing
                  ? `${sweeps.length} doors worth another try`
                  : "A better time for a second chance"}
              </h2>
              <p>
                {p.flags.timing
                  ? "Spaced visits in a different window, using your street’s recorded answers when there is enough history."
                  : "Enable timing in the pilot to see suggested not-home returns."}
              </p>
              {selectedStreetGroups[0] && (
                <button
                  className="rf-button"
                  onClick={() =>
                    setSearch(
                      selectedStreetGroups[0][0].lead.address.replace(
                        /^\s*\d+[a-z-]*\s+/i,
                        "",
                      ),
                    )
                  }
                >
                  <Target size={16} />
                  {selectedStreetGroups[0].length} doors on{" "}
                  {selectedStreetGroups[0][0].lead.address.replace(
                    /^\s*\d+[a-z-]*\s+/i,
                    "",
                  )}
                </button>
              )}
            </div>
            <div className="rf-chips">
              <button
                aria-pressed={mode === "sweep"}
                onClick={() => {
                  setMode("sweep");
                  setLimit(25);
                }}
              >
                Return now
              </button>
              <button
                aria-pressed={mode === "fit"}
                onClick={() => {
                  setMode("fit");
                  setLimit(25);
                }}
              >
                Solar fit
              </button>
            </div>
            <input
              className="rf-search"
              aria-label="Find a door or street"
              placeholder="Street, town or ZIP"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(25);
              }}
            />
            {rows.length === 0 && (
              <div className="rf-empty">
                <Radio />
                <h2>
                  {mode === "sweep"
                    ? "No suggested returns right now"
                    : "No matching doors yet"}
                </h2>
                <p>
                  {mode === "sweep"
                    ? `Suggestions use device-local time (${zone}), ${prettyHour(p.config.startHour)}–${prettyHour(p.config.endHour)}, at least 24 hours between visits, and at most ${p.config.maxAttempts} recorded attempts. Your agreed go-backs remain in Follow-ups.`
                    : "Fit requires recorded property data. Unknown fit does not mean a bad home."}
                </p>
              </div>
            )}
            <div className="rf-door-list">
              {rows.slice(0, limit).map((x) => (
                <button
                  key={x.lead.id}
                  className="rf-door-row"
                  onClick={() => p.onSelect(x.lead)}
                >
                  <span className="rf-score">
                    {scoreDoor(x.lead).known ? x.score : "—"}
                  </span>
                  <span>
                    <strong>{x.lead.address}</strong>
                    <small>
                      {x.lead.city} · {x.lead.zip}
                    </small>
                    <span className="rf-row-reason">
                      {"reason" in x ? x.reason : x.reasons[0]}
                    </span>
                  </span>
                  <ArrowUpRight size={17} />
                </button>
              ))}
            </div>
            {rows.length > limit && (
              <button
                className="rf-button"
                onClick={() => setLimit((n) => n + 25)}
              >
                Show 25 more
              </button>
            )}
            <p className="rf-caption">
              Solar fit is a rules-based sorting aid, not an appointment
              prediction. Timing describes observed answers; it cannot tell who
              is home.
            </p>
            <button
              className="rf-button"
              disabled={busy || p.offline || !p.flags.capture}
              onClick={() =>
                void action(async () => {
                  const targets = p.leads.filter(
                    (l) => accessibleDoor(l, p.user) && matching(l),
                  );
                  const count = await p.onPrepare(targets);
                  setMessage(
                    `${count} doors prepared for 24 hours on this device.`,
                  );
                })
              }
            >
              <CloudDownload size={18} />
              Prepare up to {p.config.maxCacheDoors} matching doors offline
            </button>
            {p.prepared && (
              <p className="rf-caption">
                Prepared {new Date(p.prepared).toLocaleString()}. Map imagery is
                not downloaded.
              </p>
            )}
          </>
        )}
        {tab === "insights" && (
          <>
            <div className="rf-filters">
              <label>
                Period
                <select
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                >
                  <option value={7}>Last 7 days</option>
                  <option value={30}>Last 30 days</option>
                </select>
              </label>
              {manager && (
                <div>
                  <span className="rf-caption">Rep</span>
                  <PersonPicker
                    label="Choose insight rep"
                    value={rep}
                    onChange={setRep}
                    options={repOptions}
                    allowAll
                    emptyLabel="All loaded reps"
                  />
                </div>
              )}
            </div>
            <div className="rf-metrics">
              <Metric
                label="Knocks"
                value={String(summary.knocks)}
                note="Recorded dispositions"
              />
              <Metric
                label="Contact rate"
                value={rate(summary.answered, summary.contactKnown)}
                note={`${summary.answered}/${summary.contactKnown} known answers`}
              />
              <Metric
                label="Engagement"
                value={rate(summary.engaged, summary.engagementKnown)}
                note={`${summary.engaged}/${summary.engagementKnown} timed conversations`}
              />
              <Metric
                label="Set rate"
                value={rate(summary.sets, summary.knocks)}
                note={`${summary.sets} doors marked appointment`}
              />
            </div>
            <div className="rf-card">
              <h2>What happened after the set?</h2>
              <p>
                <b>{rate(summary.shown, summary.resolved)}</b> held among{" "}
                {summary.resolved} known outcomes on doors marked set in this
                period.
              </p>
              <small>
                Latest appointment must be over 24 hours past.{" "}
                {summary.unknownOutcome} past appointments have no resolved
                outcome. This is current GHL status, not a historical booking
                cohort.
              </small>
            </div>
            {p.flags.coaching && (
              <div className="rf-feature-card">
                <span className="rf-kicker">ONE THING TO TRY</span>
                <h2>{dailyTip(recent, p.leads, p.now)}</h2>
                <small>
                  A rule-based suggestion from this sample; discuss it with your
                  manager.
                </small>
              </div>
            )}
            <p className="rf-caption">
              {summary.unknownContact} knocks have no recorded answer
              observation. Conversation length is an optional estimate. Figures
              use the doors loaded for this account and may be incomplete after
              reassignment or offline. Pending drafts are provisional.
            </p>
            <Report title="Time of day" rows={hourRows} />
            {p.flags.pitch && (
              <Report title="Opener observations" rows={openerRows} />
            )}
            <p className="rf-caption">
              Raw associations are not proof that an opener or time caused a
              better result. No winner is selected from a small sample.
            </p>
            {manager && (
              <>
                <Report
                  title="Pilot vs. control · current experiment"
                  rows={["pilot", "control"].map((group) => ({
                    name: group,
                    ...funnel(
                      recent.filter(
                        (e) =>
                          e.group === group &&
                          e.experiment === p.config.experiment,
                      ),
                      p.leads,
                      p.now,
                    ),
                  }))}
                />
                <p className="rf-caption">
                  Compare consistent assignments over at least 30 days. Keep the
                  experiment name and pilot percentage stable during a test.
                </p>
              </>
            )}
          </>
        )}
        {tab === "handoffs" && (
          <>
            {!p.flags.show ? (
              <div className="rf-empty">
                Handoff tracking is not enabled for this account.
              </div>
            ) : (
              <>
                <div className="rf-feature-card">
                  <span className="rf-kicker">KEEP INTEREST MOVING</span>
                  <h2>{handoffs.length} handoffs to review</h2>
                  <p>
                    Send the info, call your scheduling manager, and watch for
                    the confirmed appointment outcome.
                  </p>
                </div>
                {handoffs.slice(0, limit).map((l) => (
                  <article className="rf-card" key={l.id}>
                    <button className="rf-plain" onClick={() => p.onSelect(l)}>
                      <h3>
                        {l.address} <ArrowUpRight size={15} />
                      </h3>
                    </button>
                    <p>
                      {l.fieldRecovery?.callbackRequested
                        ? "Homeowner requested a callback"
                        : `Handoff ${l.fieldHandoff?.state}`}
                    </p>
                    {l.fieldRecovery?.callbackRequested && (
                      <a
                        className="rf-button"
                        href={`tel:${l.fieldRecovery.phone.replace(/[^+\d]/g, "")}`}
                      >
                        Call requested number
                      </a>
                    )}
                    <small>
                      {getAppointmentOutcome(l)?.label ||
                        "No confirmed appointment outcome yet"}
                    </small>
                    {manager && (
                      <div className="rf-chips">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () => p.onHandoff(l, "acknowledged"),
                              "Handoff acknowledged.",
                            )
                          }
                        >
                          Acknowledge
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () => p.onHandoff(l, "closed"),
                              "Handoff closed; pin history kept.",
                            )
                          }
                        >
                          Close handoff
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {handoffs.length > limit && (
                  <button
                    className="rf-button"
                    onClick={() => setLimit((n) => n + 25)}
                  >
                    Show 25 more
                  </button>
                )}
                <p className="rf-caption">
                  A sent request or link click does not count as an appointment.
                  Calendar confirmations and reminders remain with your existing
                  scheduling system.
                </p>
              </>
            )}
          </>
        )}
        {tab === "sync" && (
          <>
            <div className="rf-card">
              <h2>
                {p.drafts.length
                  ? `${p.drafts.length} changes on this device`
                  : "All queued changes are synced"}
              </h2>
              <p>
                Reconnect to sync. Conflicts stay here for review; Raydar does
                not overwrite another person’s outcome.
              </p>
              <button
                className="rf-button"
                disabled={p.syncing || p.offline}
                onClick={() => void action(p.onSync)}
              >
                <RefreshCw size={16} />
                {p.syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {p.drafts.slice(0, limit).map((d) => (
              <article className="rf-card" key={d.id}>
                <h3>
                  {p.leads.find((l) => l.id === d.leadId)?.address ||
                    "Door no longer loaded"}
                </h3>
                <p>
                  {d.kind} · {new Date(d.createdAt).toLocaleString()}
                </p>
                {d.error && <p role="alert">{d.error}</p>}
                {d.notes && (
                  <textarea
                    readOnly
                    aria-label="Unsynced note draft"
                    value={d.notes}
                  />
                )}
                <details>
                  <summary>Copy full draft for review</summary>
                  <textarea
                    readOnly
                    aria-label="Unsynced field draft"
                    value={JSON.stringify(d, null, 2)}
                  />
                </details>
                <button
                  className="rf-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Discard this unsynced draft? Copy anything you need first. Saved pin history will not change.",
                      )
                    )
                      void action(() => p.onDiscard(d.id));
                  }}
                >
                  Discard draft
                </button>
              </article>
            ))}
            {p.drafts.length > limit && (
              <button
                className="rf-button"
                onClick={() => setLimit((n) => n + 25)}
              >
                Show 25 more
              </button>
            )}
          </>
        )}
      </main>
      <MobileNav />
    </div>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div>
      <small>{label}</small>
      <b>{value}</b>
      <span>{note}</span>
    </div>
  );
}
function Report({
  title,
  rows,
}: {
  title: string;
  rows: {
    name: string;
    knocks: number;
    sets: number;
    answered: number;
    contactKnown: number;
  }[];
}) {
  return (
    <section className="rf-card">
      <h2>{title}</h2>
      <div className="rf-table">
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Knocks</th>
              <th>Contact</th>
              <th>Set</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.knocks}</td>
                <td>
                  {rate(r.answered, r.contactKnown)}
                  <small>{r.contactKnown} observed</small>
                </td>
                <td>
                  {rate(r.sets, r.knocks)}
                  <small>{r.sets} sets</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p>No recorded activity in this period.</p>}
      </div>
    </section>
  );
}
