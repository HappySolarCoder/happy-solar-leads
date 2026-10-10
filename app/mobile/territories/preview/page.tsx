"use client";
import { useRef } from "react";
import TerritoryWorkspace, {
  type TerritoryData,
  type TerritoryRequest,
} from "../TerritoryWorkspace";
import type { TerritoryPoint } from "@/app/types/territory";
import {
  insideTerritory,
  type ManagedTerritory,
} from "@/app/utils/territoryManager";
const members = [
  {
    id: "demo-manager",
    name: "Alex Morgan",
    color: "#587E98",
    role: "manager",
    team: "Demo team",
  },
  {
    id: "demo-rep",
    name: "Taylor Reed",
    color: "#B28437",
    role: "setter",
    team: "Demo team",
  },
  {
    id: "demo-rep-2",
    name: "Jordan Lee",
    color: "#6A8D80",
    role: "setter",
    team: "Demo team",
  },
];
const areas: ManagedTerritory[] = [
  {
    id: "demo-north",
    name: "Maple Street North",
    userId: "demo-rep",
    userName: "Taylor Reed",
    userColor: "#B28437",
    polygon: [
      { lat: 43.162, lng: -77.614 },
      { lat: 43.162, lng: -77.604 },
      { lat: 43.155, lng: -77.604 },
      { lat: 43.155, lng: -77.614 },
    ],
    leadIds: Array.from({ length: 42 }, (_, i) => `demo-${i}`),
    version: "demo-v1",
  },
  {
    id: "demo-west",
    name: "Parkside West",
    userId: "demo-rep-2",
    userName: "Jordan Lee",
    userColor: "#6A8D80",
    polygon: [
      { lat: 43.154, lng: -77.628 },
      { lat: 43.154, lng: -77.617 },
      { lat: 43.147, lng: -77.617 },
      { lat: 43.147, lng: -77.628 },
    ],
    leadIds: Array.from({ length: 28 }, (_, i) => `demo-b-${i}`),
    version: "demo-v1",
  },
];
const initialData: TerritoryData = {
  actor: members[0],
  members,
  territories: areas,
};
/** Explicitly fictional, memory-only workspace. No auth or company-data requests. */
export default function TerritoryPreview() {
  const data = useRef(structuredClone(initialData));
  const request: TerritoryRequest = async <T,>(
    body?: Record<string, unknown>
  ): Promise<T> => {
    if (!body) return structuredClone(data.current) as T;
    if (body.action === "preview") {
      const polygon = body.polygon as TerritoryPoint[];
      const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length,
        lng = polygon.reduce((s, p) => s + p.lng, 0) / polygon.length;
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        id: `preview-${i}`,
        lat: lat + ((i % 3) - 1) * 0.0002,
        lng: lng + (Math.floor(i / 3) - 1.5) * 0.0002,
        version: "preview-v1",
        eligible: i < 9,
      })).filter((p) => insideTerritory(p.lat, p.lng, polygon));
      return {
        candidates,
        eligible: candidates.filter((c) => c.eligible).length,
        skipped: candidates.filter((c) => !c.eligible).length,
        truncated: false,
      } as T;
    }
    if (body.action === "create") {
      const user = members.find((m) => m.id === body.userId)!;
      const area = {
        id: String(body.requestId),
        name: String(body.name),
        userId: user.id,
        userName: user.name,
        userColor: user.color,
        polygon: body.polygon as TerritoryPoint[],
        leadIds: (body.candidates as { id: string }[]).map((c) => c.id),
        version: "demo-v1",
      };
      data.current.territories.push(area);
      return { id: area.id, changed: area.leadIds.length } as T;
    }
    const area = data.current.territories.find((t) => t.id === body.id)!;
    if (body.action === "rename") area.name = String(body.name);
    if (body.action === "transfer") {
      const user = members.find((m) => m.id === body.userId)!;
      Object.assign(area, {
        userId: user.id,
        userName: user.name,
        userColor: user.color,
      });
    }
    if (body.action === "archive")
      data.current.territories = data.current.territories.filter(
        (t) => t.id !== area.id
      );
    return {
      id: area.id,
      changed: body.action === "transfer" ? area.leadIds.length : 0,
    } as T;
  };
  return (
    <TerritoryWorkspace initialData={initialData} request={request} preview />
  );
}
