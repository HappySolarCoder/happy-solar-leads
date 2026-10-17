import { isPermissionDenied } from "./permissionDenied";
import { isTestAccountUser, type TestFlags } from "./testAccount";

export const TEAM_VIEW_UNAVAILABLE = "Team view isn't available for this account.";

export interface TeamLocationMember {
  id: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  lastUpdate: Date;
  status: string;
}

const deniedViewers = new Set<string>();

export function resetTeamDirectoryDenialForTests(): void {
  deniedViewers.clear();
}

export function teamDirectoryDenied(viewerId?: string | null): boolean {
  if (viewerId == null) return deniedViewers.size > 0;
  return deniedViewers.has(viewerId);
}

function locationTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function ownTeamMember(user: (TestFlags & {
  name?: string;
  color?: string;
  status?: string;
  currentLocation?: { lat?: number; lng?: number; timestamp?: unknown };
}) | null | undefined): TeamLocationMember | null {
  const location = user?.currentLocation;
  const timestamp = locationTimestamp(location?.timestamp);
  const lat = location?.lat;
  const lng = location?.lng;
  if (
    !user?.id ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    !timestamp
  ) return null;
  return {
    id: user.id,
    name: user.name || "Team member",
    color: /^#[\da-f]{6}$/i.test(user.color || "") ? user.color! : "#52738e",
    lat,
    lng,
    lastUpdate: timestamp,
    status: user.status || "In field",
  };
}

export function membersFromActiveUsers(
  docs: Iterable<{ id: string; data: () => Record<string, unknown> }>,
  viewer: TestFlags | null | undefined,
): TeamLocationMember[] {
  const members: TeamLocationMember[] = [];
  const viewerIsTest = isTestAccountUser(viewer);
  for (const doc of docs) {
    const data = doc.data() || {};
    const person: TestFlags & { name?: string; color?: string; status?: string; currentLocation?: { lat?: number; lng?: number; timestamp?: unknown } } = {
      id: doc.id,
      name: typeof data.name === "string" ? data.name : undefined,
      color: typeof data.color === "string" ? data.color : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
      isTestAccount: data.isTestAccount === true,
      testData: data.testData === true,
      team: typeof data.team === "string" ? data.team : undefined,
      currentLocation: data.currentLocation as { lat?: number; lng?: number; timestamp?: unknown } | undefined,
    };
    if (viewerIsTest) {
      if (doc.id !== viewer?.id) continue;
    } else if (isTestAccountUser(person)) {
      continue;
    }
    const member = ownTeamMember(person);
    if (member) members.push(member);
  }
  return members;
}

export interface TeamLocationSnapshot {
  size: number;
  docs: Iterable<{ id: string; data: () => Record<string, unknown> }>;
}

/**
 * One active-user listener per signed-in account. Permission-denied unsubscribes
 * immediately and latches, so a remount does not attach again.
 */
export function subscribeActiveTeamLocations(options: {
  viewerId: string;
  attach: (
    onNext: (snapshot: TeamLocationSnapshot) => void,
    onError: (error: unknown) => void,
  ) => () => void;
  onNext: (snapshot: TeamLocationSnapshot) => void;
  onDenied: () => void;
  onUnavailable: (error: unknown) => void;
}): () => void {
  if (deniedViewers.has(options.viewerId)) {
    options.onDenied();
    return () => {};
  }
  let unsubscribe = () => {};
  let stopped = false;
  unsubscribe = options.attach(options.onNext, (error) => {
    if (!isPermissionDenied(error)) {
      options.onUnavailable(error);
      return;
    }
    if (stopped) return;
    stopped = true;
    deniedViewers.add(options.viewerId);
    try { unsubscribe(); } catch { /* The listener is already stopped. */ }
    options.onDenied();
  });
  return () => {
    stopped = true;
    try { unsubscribe(); } catch { /* The listener is already stopped. */ }
  };
}
