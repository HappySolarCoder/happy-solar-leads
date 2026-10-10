"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProofItem } from "./types";
export default function ProofMap({
  lat,
  lng,
  proof,
  satellite = false,
}: {
  lat: number;
  lng: number;
  proof: ProofItem[];
  satellite?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const map = L.map(element.current, {
      zoomControl: false,
      scrollWheelZoom: false,
    }).setView([lat, lng], satellite ? 19 : 13);
    L.tileLayer(
      satellite
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 20,
        maxNativeZoom: satellite ? 19 : 19,
        attribution: satellite
          ? "Tiles &copy; Esri"
          : "&copy; OpenStreetMap contributors",
      },
    ).addTo(map);
    L.circleMarker([lat, lng], {
      radius: 5,
      color: "#566b85",
      fillOpacity: 1,
    }).addTo(map);
    for (const p of proof) {
      if (p.lat === undefined || p.lng === undefined) continue;
      const label = document.createElement("span");
      label.textContent = p.title;
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#d59d00",
        fillOpacity: 1,
      })
        .bindPopup(label)
        .addTo(map);
    }
    return () => {
      map.remove();
    };
  }, [lat, lng, proof, satellite]);
  return (
    <div
      ref={element}
      className="rf-proof-map"
      aria-label={
        satellite
          ? "Satellite view of this roof"
          : "Map of approved local solar examples"
      }
    />
  );
}
