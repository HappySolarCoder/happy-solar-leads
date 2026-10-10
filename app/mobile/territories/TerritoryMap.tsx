"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers } from "lucide-react";
import { getLocation } from "@/app/utils/geolocation";
import type { TerritoryPoint } from "@/app/types/territory";
import type {
  ManagedTerritory,
  TerritoryCandidate,
} from "@/app/utils/territoryManager";

type Props = {
  territories: ManagedTerritory[];
  selectedId: string;
  drawing: boolean;
  points: TerritoryPoint[];
  candidates: TerritoryCandidate[];
  onPoint: (p: TerritoryPoint) => void;
  onSelect: (id: string) => void;
};
export default function TerritoryMap(props: Props) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);
  const [satellite, setSatellite] = useState(true),
    [message, setMessage] = useState("");
  const base = useRef<L.LayerGroup | null>(null),
    overlays = useRef<L.LayerGroup | null>(null),
    draft = useRef<L.LayerGroup | null>(null);
  const firstFit = useRef(false),
    selectedFit = useRef("");
  useEffect(() => {
    if (!root.current) return;
    const m = L.map(root.current, {
      zoomControl: false,
      preferCanvas: true,
      attributionControl: true,
    }).setView([43.1566, -77.6088], 13);
    map.current = m;
    L.control.zoom({ position: "topleft" }).addTo(m);
    base.current = L.layerGroup().addTo(m);
    overlays.current = L.layerGroup().addTo(m);
    draft.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      if (propsRef.current.drawing)
        propsRef.current.onPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (props.drawing) map.current?.doubleClickZoom.disable();
    else map.current?.doubleClickZoom.enable();
  }, [props.drawing]);
  useEffect(() => {
    if (!base.current) return;
    base.current.clearLayers();
    const tiles = L.tileLayer(
      satellite
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 20,
        maxNativeZoom: satellite ? 19 : 19,
        attribution: satellite
          ? "Tiles © Esri, Maxar, Earthstar Geographics"
          : "© OpenStreetMap contributors",
      }
    );
    tiles.on("tileerror", () =>
      setMessage(
        "Some map imagery could not load. Check your connection or switch map view."
      )
    );
    tiles.on("load", () => setMessage(""));
    base.current.addLayer(tiles);
    if (satellite)
      base.current.addLayer(
        L.tileLayer(
          "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 20, maxNativeZoom: 19 }
        )
      );
  }, [satellite]);
  useEffect(() => {
    if (!overlays.current || !map.current) return;
    overlays.current.clearLayers();
    props.territories.forEach((t) => {
      if (t.polygon.length < 3) return;
      const polygon = L.polygon(
        t.polygon.map((p) => [p.lat, p.lng]),
        {
          color: t.userColor,
          weight: t.id === props.selectedId ? 4 : 2,
          fillOpacity: t.id === props.selectedId ? 0.2 : 0.07,
          bubblingMouseEvents: false,
          interactive: !props.drawing,
        }
      );
      const label = document.createElement("span");
      label.textContent = `${t.name} · ${t.userName}`;
      polygon.bindTooltip(label, { sticky: true });
      polygon.on("click", () => propsRef.current.onSelect(t.id));
      overlays.current!.addLayer(polygon);
    });
    const t = props.territories.find((t) => t.id === props.selectedId);
    if (t && selectedFit.current !== t.id && !props.drawing) {
      selectedFit.current = t.id;
      map.current.fitBounds(
        L.latLngBounds(t.polygon.map((p) => [p.lat, p.lng])),
        { padding: [42, 42], animate: false, maxZoom: 17 }
      );
      firstFit.current = true;
    } else if (!firstFit.current && props.territories.length) {
      const points = props.territories.flatMap((t) =>
        t.polygon.map((p) => L.latLng(p.lat, p.lng))
      );
      if (points.length)
        map.current.fitBounds(L.latLngBounds(points), {
          padding: [32, 32],
          animate: false,
          maxZoom: 15,
        });
      firstFit.current = true;
    }
    if (!props.selectedId) selectedFit.current = "";
  }, [props.territories, props.selectedId, props.drawing]);
  useEffect(() => {
    if (!draft.current) return;
    draft.current.clearLayers();
    const coords = props.points.map((p) => L.latLng(p.lat, p.lng));
    if (coords.length > 1)
      draft.current.addLayer(
        coords.length > 2
          ? L.polygon(coords, {
              color: "#F0BC18",
              weight: 3,
              fillOpacity: 0.12,
              interactive: false,
            })
          : L.polyline(coords, {
              color: "#F0BC18",
              weight: 3,
              interactive: false,
            })
      );
    coords.forEach((p, i) => {
      const marker = L.circleMarker(p, {
        radius: 6,
        color: "#304B5E",
        fillColor: "#F0BC18",
        fillOpacity: 1,
        weight: 2,
        interactive: false,
      });
      marker.bindTooltip(String(i + 1), {
        permanent: true,
        direction: "top",
        className: "rt-corner",
      });
      draft.current!.addLayer(marker);
    });
    props.candidates.forEach((p) =>
      draft.current!.addLayer(
        L.circleMarker([p.lat, p.lng], {
          radius: 4,
          color: p.eligible ? "#476E88" : "#83919a",
          weight: 1,
          fillColor: p.eligible ? "#F0BC18" : "#fff",
          fillOpacity: 0.95,
          interactive: false,
        })
      )
    );
  }, [props.points, props.candidates]);
  async function locate() {
    setMessage("Finding your location…");
    try {
      const pos = await getLocation();
      map.current?.setView([pos.coords.latitude, pos.coords.longitude], 16);
      setMessage("");
    } catch {
      setMessage("Location is unavailable. Move the map to your neighborhood.");
    }
  }
  return (
    <div className="rt-map-wrap">
      <div
        ref={root}
        className={`rt-map${props.drawing ? " rt-drawing" : ""}`}
        aria-label="Territory map. Drag to move; use plus and minus to zoom. Tap corners while drawing."
      />
      <div className="rt-map-actions">
        <button
          onClick={() => setSatellite((v) => !v)}
          aria-label={
            satellite ? "Switch to street map" : "Switch to satellite imagery"
          }
        >
          <Layers size={18} />
          {satellite ? "Satellite" : "Street"}
        </button>
        <button onClick={locate} aria-label="Center on my location">
          <Crosshair size={20} />
        </button>
      </div>
      <span className="rt-north">N ↑</span>
      {props.drawing && (
        <p className="rt-map-hint">
          Tap each corner • drag to move • {props.points.length} corners
        </p>
      )}
      {message && (
        <p className="rt-map-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
