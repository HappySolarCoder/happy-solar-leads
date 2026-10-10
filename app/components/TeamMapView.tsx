"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { observeMapSize } from "@/app/utils/observeMapSize";

export interface TeamMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  lastUpdate: Date;
  status: string;
}
interface Props {
  teamMembers: TeamMember[];
  onMemberClick?: (member: TeamMember) => void;
}

function memberIcon(member: TeamMember) {
  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;align-items:center;width:48px";
  const mark = document.createElement("div");
  mark.style.cssText =
    "width:44px;height:44px;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px #30445c55;display:grid;place-items:center;color:white;font-weight:700;font-size:17px";
  mark.style.backgroundColor = member.color;
  mark.textContent = member.name.charAt(0);
  const label = document.createElement("span");
  label.style.cssText =
    "background:#fffcf5;padding:3px 6px;border-radius:6px;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#30445c;font-size:11px";
  label.textContent = member.name;
  root.append(mark, label);
  return L.divIcon({
    className: "raydar-team-marker",
    html: root,
    iconSize: [48, 64],
    iconAnchor: [24, 22],
  });
}
export default function TeamMapView({ teamMembers, onMemberClick }: Props) {
  const container = useRef<HTMLDivElement>(null),
    mapRef = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>()),
    frames = useRef(new Map<L.Marker, number>());
  const fitted = useRef(false),
    latest = useRef({ teamMembers, onMemberClick });
  useEffect(() => { latest.current = { teamMembers, onMemberClick }; }, [teamMembers, onMemberClick]);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { zoomControl: false }).setView(
      [43.1566, -77.6088],
      11,
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    fitted.current = false;
    const stop = observeMapSize(map);
    const activeFrames = frames.current, activeMarkers = markers.current;
    return () => {
      stop();
      for (const frame of activeFrames.values()) cancelAnimationFrame(frame);
      activeFrames.clear();
      activeMarkers.clear();
      mapRef.current = null;
      map.remove();
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const byId = new Map(teamMembers.map((member) => [member.id, member]));
    for (const [id, marker] of markers.current)
      if (!byId.has(id)) {
        const frame = frames.current.get(marker);
        if (frame) cancelAnimationFrame(frame);
        frames.current.delete(marker);
        marker.remove();
        markers.current.delete(id);
      }
    for (const member of teamMembers) {
      let marker = markers.current.get(member.id);
      if (!marker) {
        marker = L.marker([member.lat, member.lng], {
          icon: memberIcon(member),
          title: member.name,
        })
          .addTo(map)
          .on("click", () => {
            const current = latest.current.teamMembers.find(
              (value) => value.id === member.id,
            );
            if (current) latest.current.onMemberClick?.(current);
          });
        markers.current.set(member.id, marker);
      } else {
        marker.setIcon(memberIcon(member));
        const start = marker.getLatLng(),
          end = L.latLng(member.lat, member.lng),
          target = marker;
        const prior = frames.current.get(target);
        if (prior) cancelAnimationFrame(prior);
        if (start.equals(end)) continue;
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
          target.setLatLng(end);
          continue;
        }
        const began = performance.now();
        const tick = () => {
          if (mapRef.current !== map || !map.hasLayer(target)) return;
          const amount = Math.min((performance.now() - began) / 500, 1);
          target.setLatLng([
            start.lat + (end.lat - start.lat) * amount,
            start.lng + (end.lng - start.lng) * amount,
          ]);
          if (amount < 1)
            frames.current.set(target, requestAnimationFrame(tick));
          else frames.current.delete(target);
        };
        tick();
      }
    }
    if (teamMembers.length && !fitted.current) {
      fitted.current = true;
      map.fitBounds(
        L.latLngBounds(teamMembers.map((member) => [member.lat, member.lng])),
        {
          paddingTopLeft: [40, 40],
          paddingBottomRight: [40, 150],
          maxZoom: 15,
        },
      );
    }
  }, [teamMembers]);
  return (
    <div
      ref={container}
      className="h-full w-full"
      aria-label="Recent team locations map"
    />
  );
}
