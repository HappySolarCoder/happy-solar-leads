import type { TerritoryPoint } from "../types/territory";

export const MAX_TERRITORY_LEADS = 400;
export const MAX_TERRITORY_SCAN = 1000;
export type TerritoryMember = {
  id: string;
  name: string;
  color: string;
  team?: string;
  role?: string;
  isActive?: boolean;
  approved?: boolean;
  approvalStatus?: string;
  deleted?: boolean;
  deletionPending?: boolean;
};
export type ManagedTerritory = {
  id: string;
  name: string;
  userId: string;
  userName: string;
  userColor: string;
  polygon: TerritoryPoint[];
  leadIds: string[];
  leadCount?: number;
  version: string;
};
export type TerritoryCandidate = {
  id: string;
  lat: number;
  lng: number;
  version: string;
  eligible: boolean;
};
export type TerritoryReview = {
  candidates: TerritoryCandidate[];
  eligible: number;
  skipped: number;
  truncated: boolean;
};

export function mayManageTerritories(user: {
  role?: string;
  approved?: boolean;
  approvalStatus?: string;
  isActive?: boolean;
  deleted?: boolean;
  deletionPending?: boolean;
}) {
  return (
    !user.deleted &&
    !user.deletionPending &&
    user.isActive !== false &&
    ["admin", "manager"].includes(user.role || "") &&
    user.approved !== false &&
    user.approvalStatus !== "pending"
  );
}
export function inManagerTeam(actor: TerritoryMember, member: TerritoryMember) {
  return (
    actor.role === "admin" ||
    member.id === actor.id ||
    Boolean(actor.team?.trim() && actor.team.trim() === member.team?.trim())
  );
}
export function mayReceiveTerritory(member: TerritoryMember) {
  return (
    !member.deleted &&
    !member.deletionPending &&
    member.isActive !== false &&
    member.approved !== false &&
    member.approvalStatus !== "pending" &&
    ["setter", "closer", "manager", "admin"].includes(member.role || "")
  );
}

const cross = (a: TerritoryPoint, b: TerritoryPoint, c: TerritoryPoint) =>
  (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
function onSegment(a: TerritoryPoint, b: TerritoryPoint, p: TerritoryPoint) {
  return (
    Math.abs(cross(a, b, p)) < 1e-12 &&
    p.lat >= Math.min(a.lat, b.lat) - 1e-12 &&
    p.lat <= Math.max(a.lat, b.lat) + 1e-12 &&
    p.lng >= Math.min(a.lng, b.lng) - 1e-12 &&
    p.lng <= Math.max(a.lng, b.lng) + 1e-12
  );
}
function intersects(
  a: TerritoryPoint,
  b: TerritoryPoint,
  c: TerritoryPoint,
  d: TerritoryPoint
) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
export function validateTerritoryPolygon(value: unknown): TerritoryPoint[] {
  if (!Array.isArray(value) || value.length < 3 || value.length > 80)
    throw new Error("Tap between 3 and 80 corners.");
  const points = value.map((p) => ({ lat: p?.lat, lng: p?.lng }));
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.lat) ||
        !Number.isFinite(p.lng) ||
        Math.abs(p.lat) > 85 ||
        Math.abs(p.lng) > 180
    )
  )
    throw new Error("The boundary has invalid coordinates.");
  if (
    points[0].lat === points.at(-1)!.lat &&
    points[0].lng === points.at(-1)!.lng
  )
    points.pop();
  if (
    new Set(points.map((p) => `${p.lat},${p.lng}`)).size !== points.length ||
    points.length < 3
  )
    throw new Error("Use different corners for your boundary.");
  const b = territoryBounds(points);
  if (b.north - b.south > 0.2 || b.east - b.west > 0.3)
    throw new Error("Choose a neighborhood-sized area.");
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    area +=
      (a.lng - points[0].lng) * (b.lat - points[0].lat) -
      (b.lng - points[0].lng) * (a.lat - points[0].lat);
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (intersects(a, b, points[j], points[(j + 1) % points.length]))
        throw new Error(
          "Boundary lines must not cross. Undo a corner and try again."
        );
    }
  }
  if (Math.abs(area) < 1e-10)
    throw new Error(
      "Draw a larger area with at least three different corners."
    );
  return points;
}
export function territoryBounds(polygon: TerritoryPoint[]) {
  return {
    south: Math.min(...polygon.map((p) => p.lat)),
    north: Math.max(...polygon.map((p) => p.lat)),
    west: Math.min(...polygon.map((p) => p.lng)),
    east: Math.max(...polygon.map((p) => p.lng)),
  };
}
export function insideTerritory(
  lat: unknown,
  lng: unknown,
  polygon: TerritoryPoint[]
) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  )
    return false;
  const p = { lat, lng };
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (onSegment(a, b, p)) return true;
    if (
      a.lat > lat !== b.lat > lat &&
      lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng
    )
      inside = !inside;
  }
  return inside;
}
export function polygonsOverlap(a: TerritoryPoint[], b: TerritoryPoint[]) {
  return (
    a.some((p) => insideTerritory(p.lat, p.lng, b)) ||
    b.some((p) => insideTerritory(p.lat, p.lng, a)) ||
    a.some((p, i) =>
      b.some((q, j) =>
        intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])
      )
    )
  );
}
// A claim represents a rep's active work. Never move it in bulk. Also preserve
// worked leads, manual prospects, customers, notes and appointment outcomes.
export function assignableTerritoryLead(
  lead: Record<string, unknown>,
  target: string,
  previousOwner?: string
) {
  if (
    lead.leadType === "customer" ||
    lead.leadType === "sale" ||
    lead.claimedBy ||
    lead.source === "manual" ||
    lead.source === "manually-added" ||
    lead.setterId ||
    lead.appointmentOutcome ||
    lead.ghlStatus ||
    lead.dispositionedAt ||
    (Array.isArray(lead.dispositionHistory) &&
      lead.dispositionHistory.length > 0)
  )
    return false;
  if (!["unclaimed", "assigned"].includes(String(lead.status))) return false;
  return !lead.assignedTo || lead.assignedTo === (previousOwner || target);
}
