"use client";

import { useState } from "react";
import { X, MapPin, SlidersHorizontal } from "lucide-react";
import type { Lead } from "@/app/types";
import {
  MobileHeader,
  MobileNav,
  FieldToolbar,
} from "../_components/MobileShell";
import {
  FollowUpsView,
  TodayView,
  ProgressView,
} from "../_components/MobileViews";
import AppointmentOutcomeCard, {
  AppointmentOutcomeBadge,
} from "@/app/components/AppointmentOutcomeBadge";
import { getAppointmentOutcome } from "@/app/utils/appointmentOutcome";
import DoorCoach from "../_components/DoorCoach";
import { fieldPinArtwork } from "@/app/utils/fieldPin";
import MobileDialog from "../_components/MobileDialog";

// This route is a read-only design gallery. It never initializes a user session,
// reads company records, or saves a lead. Shared views are used by the real app.
const demoNow = new Date(2026, 9, 8, 10, 30);
const demoLeads: Lead[] = [
  {
    id: "demo-1",
    name: "Jamie Miller",
    address: "128 Meadow Lane",
    city: "Rochester",
    state: "NY",
    zip: "14618",
    status: "go-back",
    createdAt: demoNow,
    goBackScheduledDate: demoNow,
    goBackScheduledTime: "14:30",
    goBackNotes: "Homeowner asked for a visit after lunch.",
  },
  {
    id: "demo-2",
    name: "Alex Wilson",
    address: "46 Oakwood Drive",
    city: "Rochester",
    state: "NY",
    zip: "14618",
    status: "go-back",
    createdAt: demoNow,
    goBackScheduledDate: new Date(2026, 9, 7),
    goBackScheduledTime: "16:00",
    appointmentOutcome: "Rescheduled",
    ghlLastUpdatedAt: demoNow,
  },
  {
    id: "demo-3",
    name: "Casey Reed",
    address: "215 Elm Street",
    city: "Rochester",
    state: "NY",
    zip: "14618",
    status: "appointment",
    createdAt: demoNow,
    appointmentOutcome: "Sold",
    ghlLastUpdatedAt: demoNow,
  },
  {
    id: "demo-4",
    name: "Morgan Davis",
    address: "72 Pine Terrace",
    city: "Rochester",
    state: "NY",
    zip: "14618",
    status: "appointment",
    createdAt: demoNow,
    appointmentOutcome: "No Show",
    ghlLastUpdatedAt: demoNow,
  },
  {
    id: "demo-5",
    name: "Taylor Green",
    address: "93 Garden Avenue",
    city: "Rochester",
    state: "NY",
    zip: "14618",
    status: "go-back",
    createdAt: demoNow,
    goBackScheduledDate: new Date(2026, 9, 9),
    goBackScheduledTime: "11:00",
  },
].map((lead, index) => ({
  ...lead,
  assignedTo: "preview-rep",
  lat: 43.1566 + index * 0.001,
  lng: -77.6088 + index * 0.001,
}));
const stats = { knocks: 28, conversations: 9, appointments: 3, sales: 1 };
const week = { knocks: 142, conversations: 38, appointments: 11, sales: 4 };
const month = { knocks: 284, conversations: 76, appointments: 22, sales: 8 };
const days = ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"].map(
  (label, index) => ({
    label,
    fullLabel: `${label} October ${index + 2}`,
    knocks: [31, 0, 0, 36, 44, 34, 28][index],
  }),
);

export default function DesignPreview() {
  const [tab, setTab] = useState("/mobile");
  const [mode, setMode] = useState<"map" | "list">("map");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [dialog, setDialog] = useState("");
  const [query, setQuery] = useState("");
  const [outcomesOnly, setOutcomesOnly] = useState(false);
  function navigate(href: string) {
    if (href.startsWith("/mobile") && href !== "/mobile/more") setTab(href);
    else setDialog("Your field tools");
  }
  const visible = demoLeads.filter(
    (lead) =>
      (!outcomesOnly || getAppointmentOutcome(lead)) &&
      `${lead.name} ${lead.address}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className={tab === "/mobile/knocking" ? "rm-field-shell" : "rm-shell"}>
      <div className="rm-preview-banner">
        DESIGN PREVIEW · Fictional sample data · No live changes
      </div>
      {tab !== "/mobile/knocking" && (
        <MobileHeader
          name="Evan Day"
          onAccount={() => setDialog("Your workspace")}
        />
      )}
      {tab === "/mobile" && (
        <TodayView
          name="Evan Day"
          now={demoNow}
          metrics={stats}
          dailyTarget={45}
          goalLoading={false}
          followUps={demoLeads.filter((l) => l.status === "go-back")}
          outcomeLeads={demoLeads.filter((l) => getAppointmentOutcome(l))}
          onNavigate={navigate}
          onLead={setSelected}
        />
      )}
      {tab === "/mobile/follow-ups" && (
        <FollowUpsView
          leads={demoLeads.filter((l) => l.status === "go-back")}
          now={demoNow}
          onNavigate={navigate}
          onLead={setSelected}
        />
      )}
      {tab === "/mobile/stats" && (
        <ProgressView
          today={stats}
          week={week}
          month={month}
          days={days}
          onNavigate={navigate}
        />
      )}
      {tab === "/mobile/knocking" && (
        <>
          <FieldToolbar
            mode={mode}
            onMode={setMode}
            onSearch={() => setDialog("Find an address")}
            onFilter={() => setDialog("Map filters")}
            filterCount={Number(outcomesOnly)}
            accuracy={8}
            gpsError={false}
            gpsLoading={false}
            knocks={28}
            onLocate={() => setDialog("Location accuracy")}
          />
          {mode === "map" ? (
            <div className="rm-demo-map">
              <svg
                viewBox="0 0 420 550"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
              >
                <rect width="420" height="550" fill="#e9edde" />
                <path
                  d="M-20 140 460 380M10 470 440 230M65-20 120 590M350-20 270 590"
                  stroke="#fffef7"
                  strokeWidth="22"
                />
                <path
                  d="M-20 140 460 380M10 470 440 230M65-20 120 590M350-20 270 590"
                  stroke="#d5daca"
                  strokeWidth="1"
                />
                {Array.from({ length: 26 }, (_, i) => (
                  <rect
                    key={i}
                    x={24 + ((i * 61) % 340)}
                    y={26 + ((i * 107) % 460)}
                    width="24"
                    height="17"
                    rx="3"
                    fill="#cbd3bc"
                    transform={`rotate(27 ${24 + ((i * 61) % 340)} ${26 + ((i * 107) % 460)})`}
                  />
                ))}
                <ellipse
                  cx="209"
                  cy="285"
                  rx="57"
                  ry="57"
                  fill="#7c9cb91c"
                  stroke="#809db64d"
                />
                <circle
                  cx="209"
                  cy="285"
                  r="8"
                  fill="#597e9a"
                  stroke="white"
                  strokeWidth="3"
                />
              </svg>
              {visible.map((lead, index) => {
                const outcome = getAppointmentOutcome(lead);
                const pin = fieldPinArtwork(lead, undefined, 17);
                return (
                  <button
                    key={lead.id}
                    className="rm-demo-pin"
                    aria-label={`Open ${lead.address}${outcome ? `, ${outcome.label}` : ""}`}
                    style={{
                      left: `${17 + ((index * 17) % 67)}%`,
                      top: `${18 + ((index * 19) % 59)}%`,
                    }}
                    onClick={() => setSelected(lead)}
                  >
                    <img src={pin.url} alt="" width={44} height={51} />
                  </button>
                );
              })}
              <DoorCoach
                leads={demoLeads}
                userId="preview-rep"
                position={[43.1566, -77.6088]}
                onLead={setSelected}
                now={demoNow}
              />
              <small>Illustrative neighborhood · Sample GPS</small>
            </div>
          ) : (
            <div className="rm-content overflow-y-auto">
              <div className="rm-agenda">
                {visible.map((lead) => (
                  <button
                    className="rm-lead-row"
                    key={lead.id}
                    onClick={() => setSelected(lead)}
                  >
                    <span className="rm-lead-symbol">
                      <MapPin size={20} />
                    </span>
                    <span className="rm-lead-copy">
                      <strong>{lead.address}</strong>
                      <span>{lead.name}</span>
                      <AppointmentOutcomeBadge lead={lead} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <MobileNav active={tab} onNavigate={navigate} />
      {(selected || dialog) && (
        <MobileDialog
          title={selected ? selected.address : dialog}
          onClose={() => {
            setSelected(null);
            setDialog("");
          }}
        >
          <button
            className="rm-dialog-close"
            aria-label="Close preview panel"
            onClick={() => {
              setSelected(null);
              setDialog("");
            }}
          >
            <X size={21} />
          </button>
          {selected ? (
            <>
              <span className="rm-eyebrow">LEAD DETAILS · SAMPLE</span>
              <h2>{selected.address}</h2>
              <p>
                {selected.name} · {selected.city}, {selected.state}
              </p>
              <div className="mt-5">
                <AppointmentOutcomeCard lead={selected} />
              </div>
              <p>
                {selected.goBackNotes ||
                  "Your existing lead actions, notes, and scheduling remain available in the installed app."}
              </p>
              <button className="rm-primary" onClick={() => setSelected(null)}>
                Back to my day
              </button>
            </>
          ) : (
            <>
              <span className="rm-eyebrow">RAYDAR NEXT</span>
              <h2>{dialog}</h2>
              {dialog === "Find an address" ? (
                <>
                  <label className="rm-search rm-search-input mt-5">
                    <input
                      autoFocus
                      aria-label="Search sample addresses"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Try Elm or Oakwood"
                    />
                  </label>
                  <button
                    className="rm-primary"
                    onClick={() => {
                      setMode("list");
                      setDialog("");
                    }}
                  >
                    Show results
                  </button>
                </>
              ) : dialog === "Map filters" ? (
                <>
                  <label className="rm-check">
                    <input
                      type="checkbox"
                      checked={outcomesOnly}
                      onChange={(e) => setOutcomesOnly(e.target.checked)}
                    />
                    <SlidersHorizontal size={18} />
                    Only pins with GHL outcomes
                  </label>
                  <button className="rm-primary" onClick={() => setDialog("")}>
                    Apply filters
                  </button>
                </>
              ) : (
                <>
                  <p>
                    {dialog === "Location accuracy"
                      ? "The installed app shows the accuracy reported by your phone. This gallery uses a sample reading of ±8 m."
                      : "The installed app links to your field tools, appointments, team performance, and role-specific management screens."}
                  </p>
                  <button className="rm-primary" onClick={() => setDialog("")}>
                    Got it
                  </button>
                </>
              )}
            </>
          )}
        </MobileDialog>
      )}
    </div>
  );
}
