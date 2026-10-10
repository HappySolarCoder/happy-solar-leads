"use client";
import { useEffect, useMemo, useState } from "react";
import FieldWorkspace from "@/app/field/FieldWorkspace";
import HomeownerView from "@/app/field/HomeownerView";
import DictateButton from "@/app/field/DictateButton";
import {
  DEFAULT_FIELD_CONFIG,
  FEATURE_KEYS,
  type FieldConfig,
  type PendingMutation,
} from "@/app/field/types";
import {
  putDraft,
  readDrafts,
  removeDraft,
  putArea,
  readArea,
} from "@/app/field/deviceStore";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
import type { Lead, User } from "@/app/types";
const user: User = {
  id: "raydar-v11-demo",
  name: "Jordan Ellis",
  role: "admin",
  email: "demo@example.invalid",
  color: "#566b85",
  createdAt: new Date("2026-01-01"),
};
const config: FieldConfig = {
  ...DEFAULT_FIELD_CONFIG,
  pilotPercent: 100,
  enabled: Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, true]),
  ) as FieldConfig["enabled"],
  openers: [
    {
      id: "intro",
      label: "Company intro",
      approvedTip: "Use your manager’s approved introduction.",
    },
    {
      id: "utility",
      label: "Bill conversation",
      approvedTip:
        "Ask about the homeowner’s experience with their utility bill.",
    },
  ],
  proof: [
    {
      id: "fictional-proof",
      title: "Fictional solar example",
      city: "Demo City",
      state: "AZ",
      quote: "Design fixture only. This is not a real customer testimonial.",
      approved: true,
      permission: true,
      verifiedAt: "2026-10-01",
    },
  ],
  savings: {
    approved: true,
    approvedAt: new Date().toISOString(),
    source: "Fictional design fixture — not company pricing",
    state: "AZ",
    panelWatts: 400,
    annualKwhPerKwLow: 1400,
    annualKwhPerKwHigh: 1700,
    avoidedRateLow: 0.16,
    avoidedRateHigh: 0.2,
    monthlyPaymentPerKwLow: 14,
    monthlyPaymentPerKwHigh: 18,
    fixedMonthlyCharge: 20,
    selfConsumption: 0.7,
    exportRate: 0.05,
  },
};
function fixtures() {
  const now = new Date();
  now.setHours(15, 0, 0, 0);
  const leads: Lead[] = Array.from({ length: 65 }, (_, i) => {
    const at = new Date(now);
    at.setDate(at.getDate() - 2 - (i % 3));
    at.setHours(10 + (i % 2));
    const status = i < 7 ? "appointment" : i < 12 ? "interested" : "not-home";
    return {
      id: `fixture-${i}`,
      name: "Fictional homeowner",
      address: `${100 + i * 2} ${i % 3 === 0 ? "Maple" : "Willow"} Lane`,
      city: "Demo City",
      state: "AZ",
      zip: "85001",
      assignedTo: user.id,
      status,
      createdAt: at,
      lat: 33.45 + i / 10000,
      lng: -112.07,
      solarCategory: i % 2 ? "great" : "good",
      solarMaxPanels: 24,
      estimatedBill: 220,
      hasSouthFacingRoof: true,
      ...(i < 7
        ? {
            appointmentDateTime: new Date(
              now.getTime() - 2 * 86400000,
            ),
            appointmentOutcome:
              i < 5 ? "Show" : i === 5 ? "No Show" : "Scheduled",
          }
        : {}),
      ...(i < 12 && i >= 7
        ? {
            fieldHandoff: {
              state: "sent" as const,
              updatedAt: at.toISOString(),
              sentAt: at.toISOString(),
              updatedBy: user.id,
              setterId: user.id,
            },
          }
        : {}),
      dispositionHistory: [
        {
          disposition: DEFAULT_DISPOSITIONS.find((d) => d.id === status)!.name,
          timestamp: at,
          userId: user.id,
          userName: user.name,
          field: {
            eventId: `fixture-event-${i}`,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localHour: at.getHours(),
            localDay: at.getDay(),
            statusId: status,
            countsAsKnock: true,
            answered: i < 35,
            ...(i < 35
              ? {
                  conversation:
                    i < 22 ? ("45s-plus" as const) : ("short" as const),
                }
              : {}),
            openerId: i % 2 ? "intro" : "utility",
            flags: config.enabled,
            experiment: config.experiment,
            group: i % 2 ? ("pilot" as const) : ("control" as const),
          },
        },
      ],
    };
  });
  return { now, leads };
}
export default function FieldPreview() {
  const data = useMemo(() => fixtures(), []),
    [selected, setSelected] = useState<Lead | null>(null),
    [drafts, setDrafts] = useState<PendingMutation[]>([]),
    [prepared, setPrepared] = useState<number>(),
    [notes, setNotes] = useState(""),
    [offline, setOffline] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setDrafts(await readDrafts(user.id));
    setPrepared((await readArea(user.id))?.at);
  }
  useEffect(() => {
    void Promise.all([readDrafts(user.id), readArea(user.id)]).then(([items, area]) => { setDrafts(items);setPrepared(area?.at);setOffline(!navigator.onLine); }).catch(e => setError(e.message));
    const change = () => setOffline(!navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  return (
    <>
      <div className="rf-demo-controls">
        <label>
          Demo draft
          <input
            aria-label="Demo draft"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <DictateButton
          onText={(text) => setNotes((s) => `${s} ${text}`)}
          onKeyboard={() =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Demo draft"]')
              ?.focus()
          }
        />
        <button
          className="rf-button"
          onClick={async () => {
            await putDraft({
              id: crypto.randomUUID(),
              userId: user.id,
              leadId: data.leads[0].id,
              createdAt: new Date().toISOString(),
              kind: "notes",
              baseStatus: "appointment",
              baseNotes: "",
              notes,
            });
            await load();
          }}
        >
          Queue demo note locally
        </button>
      </div>
      <FieldWorkspace
        user={user}
        leads={data.leads}
        dispositions={DEFAULT_DISPOSITIONS}
        config={config}
        flags={config.enabled}
        now={data.now}
        offline={offline}
        drafts={drafts}
        syncing={false}
        error={error}
        prepared={prepared}
        demo
        onSelect={setSelected}
        onPrepare={async (leads) => {
          await putArea({
            userId: user.id,
            at: Date.now(),
            user,
            leads,
            config,
          });
          await load();
          return leads.length;
        }}
        onSync={async () => {
          throw Error("Design preview: no server sync or customer changes.");
        }}
        onDiscard={async (id) => {
          await removeDraft(id);
          await load();
        }}
        onHandoff={async () => {
          throw Error("Design preview: no customer changes.");
        }}
      />
      {selected && (
        <HomeownerView
          lead={selected}
          config={config}
          flags={config.enabled}
          onClose={() => setSelected(null)}
          onShown={() => {}}
          onHandoff={() => setSelected(null)}
        />
      )}
    </>
  );
}
