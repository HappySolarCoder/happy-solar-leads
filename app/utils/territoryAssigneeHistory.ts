/**
 * Territory assignee history. Written only on create and on a transfer that
 * actually changes the rep, going forward. No migration: territories without
 * assignedAt fall back to createdAt (effectiveOwner.prepareTerritories).
 */
export const ASSIGNMENT_HISTORY_CAP = 20;

export type AssignmentEntry = { userId: string; at: string; by: string };

export function assignmentStamp(
  previous: unknown,
  userId: string,
  by: string,
  at: string = new Date().toISOString(),
): { assignedAt: string; assignedBy: string; assignmentHistory: AssignmentEntry[] } {
  const prior = Array.isArray(previous)
    ? previous.filter((row): row is AssignmentEntry => Boolean(row) && typeof row === 'object' && typeof (row as AssignmentEntry).userId === 'string')
    : [];
  const history = [...prior, { userId, at, by }].slice(-ASSIGNMENT_HISTORY_CAP);
  return { assignedAt: at, assignedBy: by, assignmentHistory: history };
}
