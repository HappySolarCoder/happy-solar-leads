"use client";
// Test-only route, copied into app/ by scripts/mobile/check-map.mjs and removed afterward.
import { useState } from "react";
import dynamic from "next/dynamic";
import type { Lead, User } from "@/app/types";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
const LeadMap = dynamic(() => import("@/app/components/LeadMap"), {
  ssr: false,
});
const fixture: Lead[] = Array.from({ length: 10000 }, (_, i) => ({
  id: String(i),
  name: "Synthetic lead",
  address: `Door ${i}`,
  city: "Test",
  state: "NY",
  zip: "",
  status: "assigned",
  assignedTo: "test-rep",
  createdAt: new Date(2026, 9, 8),
  lat: 43.1566 + (Math.floor(i / 100) - 50) * 0.0007,
  lng: -77.6088 + ((i % 100) - 50) * 0.0007,
  solarCategory: "great",
}));
const rep = { id: "test-rep", name: "Test Rep", role: "setter" } as User;
const center: [number, number] = [43.1566, -77.6088];
export default function MapCheck() {
  const [leads, setLeads] = useState(fixture);
  const [position, setPosition] = useState<[number, number]>(center);
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState<[number, number]>(center);
  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          height: 44,
          flexShrink: 0,
          fontSize: 12,
        }}
      >
        <button
          onClick={() => setPosition((p) => [p[0] + 0.000001, p[1] + 0.000001])}
        >
          GPS tick
        </button>
        <button
          onClick={() =>
            setLeads((current) =>
              current.map((l) =>
                l.id === "5050" ? { ...l, appointmentOutcome: "Sold" } : l,
              ),
            )
          }
        >
          Outcome update
        </button>
        <button onClick={() => setTarget([43.1666, -77.5988])}>Pan</button>
        <button
          onClick={() =>
            setLeads((current) => current.filter((l) => l.id !== "5050"))
          }
        >
          Remove
        </button>
        <output>{selected}</output>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LeadMap
          leads={leads}
          currentUser={rep}
          userPosition={position}
          dispositionOptions={DEFAULT_DISPOSITIONS}
          center={target}
          zoom={16}
          onLeadClick={(lead) => setSelected(lead.id)}
        />
      </div>
    </div>
  );
}
