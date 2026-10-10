"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers } from "lucide-react";
import { getLocation } from "@/app/utils/geolocation";
import type { Place } from "./PlaceSearch";
import type { DrawingTool } from "./drawing";
import type { TerritoryPoint } from "@/app/types/territory";
import type {
  ManagedTerritory,
  TerritoryCandidate,
} from "@/app/utils/territoryManager";

type Props = {
  territories: ManagedTerritory[];
  selectedId: string;
  drawing: boolean;
  drawingTool: DrawingTool;
  searchPlace: Place | null;
  onDraw: (points: TerritoryPoint[]) => void;
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
  const [panMode, setPanMode] = useState(false);
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
    // Use the original pointer gesture for corner taps; synthesized touch clicks
    // can be swallowed when switching away from freehand drawing.
    const container = root.current;
    let tap: { id: number; x: number; y: number } | null = null;
    const pointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) {
        tap = null;
        return;
      }
      if (
        e.button !== 0 ||
        (e.target as HTMLElement).closest(".leaflet-control")
      )
        return;
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    const pointerMove = (e: PointerEvent) => {
      if (
        tap &&
        e.pointerId === tap.id &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8
      )
        tap = null;
    };
    const pointerEnd = (e: PointerEvent) => {
      const wasTap =
        tap &&
        e.pointerId === tap.id &&
        Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 8;
      tap = null;
      if (
        !wasTap ||
        e.type === "pointercancel" ||
        !propsRef.current.drawing ||
        propsRef.current.drawingTool === "freehand"
      )
        return;
      const point = m.mouseEventToContainerPoint(e),
        size = m.getSize();
      if (point.x < 0 || point.y < 0 || point.x > size.x || point.y > size.y)
        return;
      const ll = m.containerPointToLatLng(point);
      propsRef.current.onPoint({ lat: ll.lat, lng: ll.lng });
    };
    container.addEventListener("pointerdown", pointerDown, true);
    container.addEventListener("pointermove", pointerMove, true);
    container.addEventListener("pointerup", pointerEnd, true);
    container.addEventListener("pointercancel", pointerEnd, true);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      container.removeEventListener("pointerdown", pointerDown, true);
      container.removeEventListener("pointermove", pointerMove, true);
      container.removeEventListener("pointerup", pointerEnd, true);
      container.removeEventListener("pointercancel", pointerEnd, true);
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (props.drawing) map.current?.doubleClickZoom.disable();
    else map.current?.doubleClickZoom.enable();
  }, [props.drawing]);
  useEffect(() => {
    const m = map.current,
      container = root.current;
    if (
      !m ||
      !container ||
      !props.drawing ||
      props.drawingTool !== "freehand" ||
      panMode
    )
      return;
    m.dragging.disable();
    m.touchZoom.disable();
    m.scrollWheelZoom.disable();
    m.boxZoom.disable();
    container.style.touchAction = "none";
    let samples: L.Point[] = [],
      pointer: number | null = null;
    const stroke = L.polyline([], {
      color: "#F0BC18",
      weight: 3,
      interactive: false,
    }).addTo(m);
    function collect(e: PointerEvent) {
      const p = m!.mouseEventToContainerPoint(e);
      const rect = container!.getBoundingClientRect();
      if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) return;
      if (!samples.length || p.distanceTo(samples[samples.length - 1]) >= 4) {
        samples.push(p);
        // Bound work while retaining the entire traced shape.
        if (samples.length > 1600)
          samples = samples.filter((_, i) => i % 2 === 0);
        stroke.setLatLngs(samples.map((p) => m!.containerPointToLatLng(p)));
      }
    }
    function down(e: PointerEvent) {
      if (
        e.button !== 0 ||
        !e.isPrimary ||
        pointer !== null ||
        (e.target as HTMLElement).closest(".leaflet-control")
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      pointer = e.pointerId;
      samples = [];
      container!.setPointerCapture(pointer);
      collect(e);
    }
    function move(e: PointerEvent) {
      if (e.pointerId === pointer) {
        e.preventDefault();
        collect(e);
      }
    }
    function end(e: PointerEvent) {
      if (e.pointerId !== pointer) return;
      if (e.type !== "pointercancel") {
        collect(e);
        let simplified = L.LineUtil.simplify(samples, 3);
        if (simplified.length > 80)
          simplified = Array.from(
            { length: 80 },
            (_, i) => simplified[Math.floor((i * (simplified.length - 1)) / 79)]
          );
        if (simplified.length >= 3)
          propsRef.current.onDraw(
            simplified.map((p) => {
              const ll = m!.containerPointToLatLng(p);
              return { lat: ll.lat, lng: ll.lng };
            })
          );
        else
          setMessage(
            "Draw a larger boundary, then lift your finger to finish."
          );
      }
      pointer = null;
      stroke.setLatLngs([]);
      if (container!.hasPointerCapture(e.pointerId))
        container!.releasePointerCapture(e.pointerId);
    }
    container.addEventListener("pointerdown", down, true);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", end);
    return () => {
      container.removeEventListener("pointerdown", down, true);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", end);
      container.removeEventListener("pointercancel", end);
      stroke.remove();
      container.style.touchAction = "";
      m.dragging.enable();
      m.touchZoom.enable();
      m.scrollWheelZoom.enable();
      m.boxZoom.enable();
    };
  }, [props.drawing, props.drawingTool, panMode]);
  useEffect(() => {
    const p = props.searchPlace,
      m = map.current;
    if (!p || !m) return;
    if (p.bounds)
      m.fitBounds(p.bounds, { padding: [24, 24], maxZoom: 15, animate: false });
    else m.setView([p.lat, p.lng], 14, { animate: false });
    firstFit.current = true;
  }, [props.searchPlace]);
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
    if (props.drawingTool !== "freehand")
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
  }, [props.points, props.candidates, props.drawingTool]);
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
    <div className={`rt-map-wrap${props.drawing ? " rt-drawing" : ""}`}>
      <div
        ref={root}
        className="rt-map"
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
      {props.drawing && props.drawingTool === "freehand" && (
        <button
          className="rt-pan-draw"
          aria-pressed={panMode}
          onClick={() => setPanMode((v) => !v)}
        >
          {panMode ? "Resume drawing" : "Move map"}
        </button>
      )}
      {props.drawing && (
        <p className="rt-map-hint">
          {props.drawingTool === "freehand"
            ? panMode
              ? "Drag or pinch to position the map"
              : "Trace the boundary • lift to finish"
            : props.drawingTool === "rectangle"
            ? props.points.length === 1
              ? "Tap the opposite corner"
              : props.points.length === 4
              ? "4 corners • rectangle ready"
              : "Tap the first corner of your rectangle"
            : `Tap each corner • ${props.points.length} corners`}
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
