"use client";

import { useState } from "react";
import OutcomeFeed from "./OutcomeFeed";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  DoorOpen,
  MapPin,
  MessageCircle,
  Search,
  Sun,
  Target,
  TrendingUp,
} from "lucide-react";
import type { Lead } from "@/app/types";
import { formatGoBackScheduledTime } from "@/app/utils/timezone";
import { followUpBucket } from "../_lib/metrics";
import { AppointmentOutcomeBadge } from "@/app/components/AppointmentOutcomeBadge";
import { SectionHeading } from "./MobileShell";

export type Metrics = {
  knocks: number;
  conversations: number;
  appointments: number;
  sales: number;
};
export type Navigate = (href: string) => void;

export function NeighborhoodArt() {
  return (
    <svg
      className="rm-neighborhood"
      viewBox="0 0 300 195"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M-20 146 120 66 327 166M-30 60 118 148 298 44"
        stroke="white"
        strokeOpacity=".12"
        strokeWidth="30"
      />
      <path
        d="M-20 146 120 66 327 166M-30 60 118 148 298 44"
        stroke="white"
        strokeOpacity=".35"
        strokeDasharray="4 8"
      />
      {[
        [87, 48],
        [194, 44],
        [182, 131],
        [46, 116],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path
            d="m0 0 22-13L45 0 23 13Z"
            fill={i === 0 ? "#FFE595" : "#B3C9D8"}
          />
          <path d="M0 0v22l23 14V13Z" fill={i === 0 ? "#F0BC18" : "#769BB3"} />
          <path
            d="m23 13 22-13v22L23 36Z"
            fill={i === 0 ? "#FFCF4A" : "#95B3C6"}
          />
          <path d="m5-3 14-8 9 5-14 8Z" fill="#304B5E" />
          <path d="m16 4 14-8 9 5-14 8Z" fill="#304B5E" />
        </g>
      ))}
      <ellipse
        cx="141"
        cy="100"
        rx="27"
        ry="16"
        stroke="#FFE595"
        strokeOpacity=".4"
      />
      <ellipse
        cx="141"
        cy="100"
        rx="18"
        ry="10"
        fill="#FFDD70"
        fillOpacity=".2"
      />
      <path
        d="M141 60c-10 0-18 8-18 18 0 13 18 29 18 29s18-16 18-29c0-10-8-18-18-18Z"
        fill="#F0BC18"
      />
      <circle cx="141" cy="78" r="6" fill="#FFF9F3" />
      <circle cx="64" cy="66" r="7" fill="#CBDCE7" />
      <circle cx="239" cy="125" r="10" fill="#CBDCE7" />
      <circle cx="258" cy="133" r="6" fill="#B3C9D8" />
    </svg>
  );
}

export function LeadRow({
  lead,
  now,
  onSelect,
}: {
  lead: Lead;
  now: Date;
  onSelect: (lead: Lead) => void;
}) {
  const bucket = followUpBucket(lead, now);
  const date = lead.goBackScheduledDate
    ? new Date(lead.goBackScheduledDate)
    : null;
  const label =
    bucket === "today"
      ? "Today"
      : bucket === "overdue"
      ? "Overdue"
      : bucket === "unscheduled"
      ? "Unscheduled"
      : date?.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
  return (
    <button className="rm-lead-row" onClick={() => onSelect(lead)}>
      <span
        className={`rm-lead-symbol ${bucket === "overdue" ? "is-overdue" : ""}`}
      >
        <MapPin size={21} />
      </span>
      <span className="rm-lead-copy">
        <strong>{lead.address || "Address not provided"}</strong>
        <span>
          {lead.name || "Homeowner"}
          {lead.city ? ` · ${lead.city}` : ""}
        </span>
        <AppointmentOutcomeBadge lead={lead} />
        <span className="rm-lead-time">
          <span
            className={`rm-status ${bucket === "overdue" ? "is-overdue" : ""}`}
          >
            {label}
          </span>
          {formatGoBackScheduledTime(lead.goBackScheduledTime) || "Anytime"}
        </span>
      </span>
      <ChevronRight size={18} className="rm-muted" />
    </button>
  );
}

export function TodayView({
  userId,
  name,
  now,
  metrics,
  followUps,
  outcomeLeads = [],
  dailyTarget,
  goalLoading,
  dataLoading = false,
  dataUnavailable = false,
  liveNavigation = false,
  onNavigate,
  onLead,
}: {
  userId: string;
  name: string;
  now: Date;
  metrics: Metrics;
  followUps: Lead[];
  outcomeLeads?: Lead[];
  dailyTarget: number | null;
  goalLoading: boolean;
  dataLoading?: boolean;
  dataUnavailable?: boolean;
  liveNavigation?: boolean;
  onNavigate: Navigate;
  onLead: (lead: Lead) => void;
}) {
  const pending = dataLoading || dataUnavailable;
  const pendingMessage = dataUnavailable
    ? "Activity is unavailable. Check your connection and account access."
    : "Loading your activity…";
  const paceLoading = goalLoading || pending;
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
      ? "Good afternoon"
      : "Good evening";
  const due = followUps.filter((l) =>
    ["today", "overdue"].includes(followUpBucket(l, now))
  );
  const next = [...followUps]
    .sort(
      (a, b) =>
        new Date(a.goBackScheduledDate || 8640000000000000).getTime() -
        new Date(b.goBackScheduledDate || 8640000000000000).getTime()
    )
    .slice(0, 2);
  const progress =
    dailyTarget && dailyTarget > 0
      ? Math.min(100, (metrics.knocks / dailyTarget) * 100)
      : 0;
  return (
    <main className="rm-content rm-enter">
      <div className="rm-greeting">
        <span className="rm-eyebrow">
          {now.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </span>
        <h1>
          {greeting},<br />
          <span>{name.split(" ")[0]}.</span>
        </h1>
        <p>A little momentum goes a long way.</p>
      </div>
      <button
        className="rm-field-card"
        onClick={() => onNavigate("/mobile/knocking")}
      >
        <NeighborhoodArt />
        <span className="rm-field-card-label">
          <span className="rm-tiny-pill">
            <span />
            LET’S GET OUT THERE
          </span>
          <strong>
            Your next door.
            <br />
            Your next opportunity.
          </strong>
          <span className="rm-field-cta">
            Start knocking <ArrowRight size={19} />
          </span>
        </span>
      </button>
      <SectionHeading
        title="Your day, so far"
        action="See progress"
        onAction={() => onNavigate("/mobile/stats")}
      />
      <div className="rm-metrics" aria-busy={dataLoading}>
        <div>
          <span className="rm-metric-icon coral">
            <DoorOpen size={19} />
          </span>
          <strong>{pending ? "—" : metrics.knocks}</strong>
          <span>Doors knocked</span>
        </div>
        <div>
          <span className="rm-metric-icon sage">
            <MessageCircle size={19} />
          </span>
          <strong>{pending ? "—" : metrics.conversations}</strong>
          <span>Interested+</span>
        </div>
        <div>
          <span className="rm-metric-icon gold">
            <CalendarDays size={19} />
          </span>
          <strong>{pending ? "—" : metrics.appointments}</strong>
          <span>Appointments+</span>
        </div>
      </div>
      <div className="rm-goal-card">
        <div className="rm-goal-heading">
          <span>
            <Target size={17} />
            Daily pace
          </span>
          <b>
            {paceLoading
              ? "Loading…"
              : dailyTarget === null
              ? "No goal set"
              : dailyTarget === 0
              ? "Month goal reached"
              : `${metrics.knocks} / ${dailyTarget}`}
          </b>
        </div>
        {!paceLoading && dailyTarget !== null && dailyTarget > 0 ? (
          <>
            <div
              className="rm-progress-track"
              role="progressbar"
              aria-label="Daily knock pace"
              aria-valuenow={metrics.knocks}
              aria-valuemin={0}
              aria-valuemax={Math.max(dailyTarget, metrics.knocks)}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <p>
              {metrics.knocks >= dailyTarget
                ? "You’ve reached your pace for today."
                : `${
                    dailyTarget - metrics.knocks
                  } more doors to reach today’s pace.`}
            </p>
          </>
        ) : (
          <p>
            {paceLoading
              ? pending
                ? pendingMessage
                : "Checking your monthly goal."
              : dailyTarget === 0
              ? "Your monthly knock goal is complete. Keep the momentum going."
              : "Your manager can set a monthly knock goal."}
          </p>
        )}
      </div>
      <SectionHeading
        title="On your radar"
        action="View all"
        href={liveNavigation ? "/mobile/follow-ups" : undefined}
        onAction={() => onNavigate("/mobile/follow-ups")}
      />
      <div className="rm-agenda">
        <div className="rm-agenda-heading">
          <span>
            <CalendarDays size={16} />
            Follow-ups
          </span>
          <span>{pending ? "—" : `${due.length} need attention`}</span>
        </div>
        {pending ? (
          <p className="rm-data-loading" role="status">
            {pendingMessage}
          </p>
        ) : next.length ? (
          next.map((lead) => (
            <LeadRow key={lead.id} lead={lead} now={now} onSelect={onLead} />
          ))
        ) : (
          <div className="rm-empty-inline">
            <Check size={22} />
            <div>
              <strong>Your follow-ups are clear</strong>
              <p>Schedule a go-back from any lead to see it here.</p>
            </div>
          </div>
        )}
      </div>
      {pending ? (
        <p className="rm-data-loading">
          {dataUnavailable
            ? "Appointment outcomes are unavailable."
            : "Loading appointment outcomes…"}
        </p>
      ) : (
        <OutcomeFeed
          key={userId}
          leads={outcomeLeads}
          userId={userId}
          onLead={onLead}
        />
      )}
      <button className="rm-tool-link" onClick={() => onNavigate("/tools")}>
        <span className="rm-metric-icon gold">
          <Sun size={22} />
        </span>
        <span>
          <strong>A little backup at the door</strong>
          <small>Open your field tools</small>
        </span>
        <ArrowRight size={18} />
      </button>
    </main>
  );
}

export function FollowUpsView({
  leads,
  now,
  onLead,
  onNavigate,
}: {
  leads: Lead[];
  now: Date;
  onLead: (lead: Lead) => void;
  onNavigate: Navigate;
}) {
  const [filter, setFilter] = useState<
    "all" | "today" | "overdue" | "upcoming"
  >("all");
  const [search, setSearch] = useState("");
  const filtered = leads.filter(
    (lead) =>
      (filter === "all" || followUpBucket(lead, now) === filter) &&
      `${lead.name} ${lead.address} ${lead.city}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  );
  const groups = ["overdue", "today", "upcoming", "unscheduled"] as const;
  return (
    <main className="rm-content rm-enter">
      <div className="rm-page-heading">
        <span className="rm-eyebrow">KEEP THE CONVERSATION GOING</span>
        <h1>
          Follow-ups<span className="rm-heading-dot">.</span>
        </h1>
        <p>Your go-backs, in one clear place.</p>
      </div>
      <label className="rm-search rm-search-input">
        <Search size={19} />
        <input
          aria-label="Search follow-ups"
          placeholder="Search name or address"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="rm-filter-tabs" aria-label="Follow-up filters">
        {(["all", "today", "overdue", "upcoming"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "all"
              ? "All"
              : value === "today"
              ? "Today"
              : value === "overdue"
              ? "Overdue"
              : "Upcoming"}
            <span>
              {
                leads.filter(
                  (l) => value === "all" || followUpBucket(l, now) === value
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {filtered.length ? (
        groups.map((group) => {
          const entries = filtered
            .filter((l) => followUpBucket(l, now) === group)
            .sort(
              (a, b) =>
                new Date(a.goBackScheduledDate || 0).getTime() -
                  new Date(b.goBackScheduledDate || 0).getTime() ||
                (a.goBackScheduledTime || "").localeCompare(
                  b.goBackScheduledTime || ""
                )
            );
          return entries.length ? (
            <section key={group}>
              <SectionHeading
                title={
                  group === "overdue"
                    ? "Needs a new visit"
                    : group === "today"
                    ? "Today’s visits"
                    : group === "upcoming"
                    ? "Coming up"
                    : "Choose a date"
                }
              />
              <div className="rm-agenda">
                {entries.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    now={now}
                    onSelect={onLead}
                  />
                ))}
              </div>
            </section>
          ) : null;
        })
      ) : (
        <div className="rm-empty">
          <CalendarDays size={34} />
          <h2>{search ? "No matching follow-ups" : "Nothing on this list"}</h2>
          <p>
            {search
              ? "Try a different name or address."
              : "Open a lead and schedule a go-back. It will appear here."}
          </p>
          <button
            className="rm-primary"
            onClick={() =>
              search || filter !== "all"
                ? (setSearch(""), setFilter("all"))
                : onNavigate("/mobile/knocking")
            }
          >
            {search || filter !== "all" ? "Clear filters" : "Open the map"}
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </main>
  );
}

export function ProgressView({
  today,
  week,
  month,
  days,
  onNavigate,
}: {
  today: Metrics;
  week: Metrics;
  month: Metrics;
  days: { label: string; fullLabel: string; knocks: number }[];
  onNavigate: Navigate;
}) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("week");
  const metrics = { today, week, month }[period];
  const max = Math.max(...days.map((d) => d.knocks), 1);
  return (
    <main className="rm-content rm-enter">
      <div className="rm-page-heading">
        <span className="rm-eyebrow">EVERY DOOR COUNTS</span>
        <h1>
          Your progress<span className="rm-heading-dot">.</span>
        </h1>
        <p>Small actions. Steady momentum.</p>
      </div>
      <div className="rm-period" aria-label="Activity period">
        {(["today", "week", "month"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
          >
            {value === "today"
              ? "Today"
              : value === "week"
              ? "This week"
              : "This month"}
          </button>
        ))}
      </div>
      <section className="rm-progress-hero">
        <div>
          <span>
            <DoorOpen size={18} />
            Doors knocked
          </span>
          <strong>{metrics.knocks}</strong>
          <small>
            {period === "today"
              ? "Today"
              : period === "week"
              ? "Since Monday"
              : "This calendar month"}
          </small>
        </div>
        <div className="rm-progress-orbit" aria-hidden="true">
          <TrendingUp size={42} />
        </div>
      </section>
      <div className="rm-metrics rm-metrics-compact">
        <div>
          <strong>{metrics.conversations}</strong>
          <span>Interested+</span>
        </div>
        <div>
          <strong>{metrics.appointments}</strong>
          <span>Appointments+</span>
        </div>
        <div>
          <strong>{metrics.sales}</strong>
          <span>Sales</span>
        </div>
      </div>
      <section className="rm-chart-card">
        <SectionHeading title="Your last 7 days" />
        <div
          className="rm-bar-chart"
          role="img"
          aria-label={days
            .map((d) => `${d.fullLabel}: ${d.knocks} knocks`)
            .join("; ")}
        >
          {days.map((day, index) => (
            <div className="rm-bar-column" key={day.fullLabel}>
              <b>{day.knocks}</b>
              <div className="rm-bar-space">
                <span
                  className={index === 6 ? "is-today" : ""}
                  style={{
                    height: `${
                      day.knocks ? Math.max(3, (day.knocks / max) * 100) : 2
                    }%`,
                  }}
                />
              </div>
              <span>{day.label}</span>
            </div>
          ))}
        </div>
        <p className="rm-chart-caption">
          <span />
          Doors knocked <span className="coral-dot" />
          Today
        </p>
      </section>
      <section className="rm-agenda rm-rates">
        <SectionHeading title="From interest to appointment" />
        <div>
          <span>Appointment share of knocks</span>
          <strong>
            {metrics.knocks
              ? `${Math.round((metrics.appointments / metrics.knocks) * 100)}%`
              : "—"}
          </strong>
        </div>
        <div className="rm-progress-track">
          <span
            style={{
              width: `${
                metrics.knocks
                  ? Math.min(100, (metrics.appointments / metrics.knocks) * 100)
                  : 0
              }%`,
            }}
          />
        </div>
        <p>
          Interested+ includes interested, appointment, and sale outcomes.
          Appointments+ includes appointments and sales. Activity uses each
          lead’s latest disposition in the selected period.
        </p>
      </section>
      <button
        className="rm-primary rm-full"
        onClick={() => onNavigate("/mobile/knocking")}
      >
        Back to the doors
        <ArrowRight size={19} />
      </button>
    </main>
  );
}
