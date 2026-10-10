"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { geohashForLocation } from "geofire-common";
import type { Lead, User } from "@/app/types";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
import { HomeownerDetail, HomeownerSection } from "@/app/homeowners/Details";
import { hashNumber, type Homeowner, type View } from "@/app/homeowners/model";
import { HomeownerLoader, type HomeownerState } from "@/app/homeowners/loader";
import { readTile, saveTile } from "@/app/homeowners/cache";
import FieldCompass from "../../_components/FieldCompass";
const LeadMap = dynamic(() => import("@/app/components/LeadMap"), {
  ssr: false,
});
const center: [number, number] = [43.152, -77.602];
const user = {
  id: "homeowner-fixture",
  name: "Demo FMA",
  role: "setter",
} as User;
const homes: Homeowner[] = Array.from({ length: 1200 }, (_, i) => {
  const lat = center[0] + (Math.floor(i / 40) - 15) * 0.0005,
    lng = center[1] + ((i % 40) - 20) * 0.0006,
    geohash = geohashForLocation([lat, lng], 9);
  return {
    id: `fixture-${i}`,
    ownerName: `Fictional Owner ${i}`,
    address: `${100 + i} Example St`,
    addressNorm: `${100 + i} EXAMPLE ST`,
    municipality: "Rochester",
    state: "NY",
    lat,
    lng,
    geohash,
    geohash5: geohash.slice(0, 5),
    occupancyStatus:
      i % 3 === 0 ? "Absentee / Possible Renter" : "Owner-Occupied",
    ...(i === 619 ? { suspectedRenter: false } : {}),
    mailingCity: "Rochester",
    mailingZip: "14620",
    propertyType: "1 Family",
  };
});
const worked = homes[620];
const leads: Lead[] = [
  {
    id: "worked",
    name: "Fictional visit",
    address: worked.address,
    city: worked.municipality,
    state: "NY",
    zip: "14620",
    status: "not-home",
    lat: worked.lat,
    lng: worked.lng,
    createdAt: new Date("2026-10-10"),
    dispositionedAt: new Date("2026-10-10"),
    claimedBy: user.id,
  },
  {
    id: "older",
    name: "Older visit at same house",
    address: worked.address + " APT 2",
    city: worked.municipality,
    state: "NY",
    zip: "14620",
    status: "interested",
    lat: worked.lat,
    lng: worked.lng,
    createdAt: new Date("2026-10-09"),
    dispositionedAt: new Date("2026-10-09"),
    claimedBy: user.id,
  },
];
const cacheView: View = {
  south: 43.15,
  north: 43.154,
  west: -77.605,
  east: -77.6,
  zoom: 17,
};
export default function HomeownersPreview() {
  const [selected, setSelected] = useState<Homeowner>(),
    [lead, setLead] = useState<Lead>(),
    [zoom, setZoom] = useState(17),
    [cacheResult, setCacheResult] = useState(""),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(true);
  async function cacheCheck() {
    setBusy(true);
    let reads = 0,
      queries = 0;
    const scope = "raydar-homeowner-fixture";
    const loader = new HomeownerLoader({
      read: (tile) => readTile(scope, tile),
      save: (tile) => saveTile(scope, tile),
      online: () => navigator.onLine,
      fetch: async (r) => {
        queries++;
        const docs = homes
          .filter((h) => {
            const n = hashNumber(h.geohash);
            return n >= r.lo && n < r.hi;
          })
          .slice(0, 500);
        reads += Math.max(1, docs.length);
        return { docs, rawCount: docs.length };
      },
    });
    const result = await new Promise<HomeownerState>((resolve) =>
      loader.request(cacheView, (s) => {
        if (!s.loading) resolve(s);
      }),
    );
    setCacheResult(
      `${result.homes.length} saved homes · ${queries} queries · ${reads} reads${result.offline ? " · offline" : ""}`,
    );
    setBusy(false);
  }
  return (
    <div
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#fffcf5",
      }}
    >
      <div
        style={{
          padding: 8,
          fontSize: 12,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong>Fictional map test · no live data</strong>
        <button onClick={() => setZoom(13)}>Zoom out</button>
        <button onClick={() => setZoom(15)}>Neighborhood view</button>
        <button onClick={() => setZoom(17)}>Street view</button>
        <button onClick={() => setZoom(18)}>Roof view</button>
        <button onClick={() => setEnabled((v) => !v)}>Toggle homes</button>
        <button disabled={busy} onClick={() => void cacheCheck()}>
          Check device cache
        </button>
        <span role="status">{cacheResult}</span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <LeadMap
          leads={leads}
          currentUser={user}
          dispositionOptions={DEFAULT_DISPOSITIONS}
          center={center}
          zoom={zoom}
          userPosition={center}
          showZoomControl={false}
          showLocateControl={false}
          showHomeowners={enabled}
          homeownerFixture={homes}
          selectedHomeownerId={selected?.id}
          onHomeownerClick={(h) => {
            setSelected(h);
            setLead(undefined);
          }}
          onLeadClick={(l, h) => {
            setLead(l);
            setSelected(h);
          }}
        />
        <FieldCompass />
      </div>
      {selected && !lead && (
        <HomeownerDetail
          homeowner={selected}
          onClose={() => setSelected(undefined)}
        />
      )}{" "}
      {lead && (
        <div
          className="rm-lead-detail rh-detail"
          role="dialog"
          aria-label="Existing visit fixture"
        >
          <div className="rh-detail-heading">
            Existing visit
            <button
              onClick={() => {
                setLead(undefined);
                setSelected(undefined);
              }}
            >
              Close visit
            </button>
          </div>
          <div className="rh-detail-content">
            <h2>{lead.address}</h2>
            <p>
              {lead.name} · {lead.status}
            </p>
            <HomeownerSection homeowner={selected} />
          </div>
        </div>
      )}
    </div>
  );
}
