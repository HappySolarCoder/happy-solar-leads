/** Synthetic App Review / training accounts. Real screens omit them from totals. */
export interface TestFlags {
  id?: string;
  isTestAccount?: boolean;
  testData?: boolean;
  team?: string;
}

export function isTestAccountUser(user: TestFlags | null | undefined): boolean {
  if (!user) return false;
  return user.isTestAccount === true || user.testData === true || user.team === "TEST";
}

export function isTestDataRecord(record: { testData?: boolean } | null | undefined): boolean {
  return record?.testData === true;
}

export function leadActorIds(lead: {
  claimedBy?: string;
  assignedTo?: string;
  setterId?: string;
  dispositionHistory?: { userId?: string }[];
}): string[] {
  const ids = [
    lead.dispositionHistory?.[0]?.userId,
    lead.claimedBy,
    lead.assignedTo,
    lead.setterId,
  ];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Personal goals count the viewer's own knocks. A test account keeps its own
 * test rows. A real account does not count testData rows.
 */
export function countRecordForViewer(
  viewer: TestFlags | null | undefined,
  record: { testData?: boolean } | null | undefined,
): boolean {
  if (isTestAccountUser(viewer)) return true;
  return !isTestDataRecord(record);
}

/**
 * Team totals, leaderboards and stats. A test viewer keeps only their own rows.
 * A real viewer drops test accounts and records flagged testData or owned by one.
 */
export function scopeTeamTotals<U extends TestFlags, R extends { testData?: boolean }>(input: {
  viewer: TestFlags | null | undefined;
  users: U[];
  records: R[];
  actorIds: (record: R) => string[];
}): { users: U[]; records: R[] } {
  if (isTestAccountUser(input.viewer)) {
    const id = input.viewer?.id;
    return {
      users: input.users.filter((user) => !!id && user.id === id),
      records: input.records.filter((record) => !!id && input.actorIds(record).includes(id)),
    };
  }
  const testIds = new Set(
    input.users.filter(isTestAccountUser).map((user) => user.id).filter((id): id is string => !!id),
  );
  return {
    users: input.users.filter((user) => !isTestAccountUser(user)),
    records: input.records.filter((record) => {
      if (isTestDataRecord(record)) return false;
      const primary = input.actorIds(record)[0];
      return !(primary && testIds.has(primary));
    }),
  };
}

/** When the directory was denied, still show the signed-in person's own row. */
export function ensureViewerPerformanceRow<T extends { userId: string }>(
  rows: T[],
  viewer: { id: string; name: string } | null | undefined,
  limited: boolean,
  blank: (viewer: { id: string; name: string }) => T,
): T[] {
  if (!limited || !viewer?.id) return rows;
  if (rows.some((row) => row.userId === viewer.id)) return rows;
  return [...rows, blank(viewer)];
}
