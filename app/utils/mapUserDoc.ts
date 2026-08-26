import type { User } from '../types';

/**
 * PR 125 / live-line Timestamp | Date | string | missing parse.
 * Never call toDate() unless it exists. One bad field normalizes;
 * it must not throw.
 */
export function parseUserDate(value: any, fallback: Date): Date;
export function parseUserDate(value: any, fallback: undefined): Date | undefined;
export function parseUserDate(value: any, fallback: Date | undefined): Date | undefined {
  try {
    // Same pattern as mapLeadDoc / PR 125 getAllUsers:
    // value?.toDate ? value.toDate() : (value ? new Date(value) : fallback)
    return value?.toDate ? value.toDate() : (value ? new Date(value) : fallback);
  } catch {
    return fallback;
  }
}

export function mapUserDoc(docSnap: { id: string; data: () => any }): User {
  const data = docSnap.data();
  return {
    ...data,
    id: docSnap.id,
    createdAt: parseUserDate(data.createdAt, new Date()),
    lastLogin: parseUserDate(data.lastLogin, undefined),
    approvalRequestedAt: parseUserDate(data.approvalRequestedAt, undefined),
  } as User;
}

/**
 * Map a users collection snapshot. A bad date on one doc must not abort
 * the rest of the roster. Real fetch failures stay with getAllUsers.
 */
export function mapUserDocs(docs: Array<{ id: string; data: () => any }>): User[] {
  const users: User[] = [];
  for (const docSnap of docs) {
    try {
      users.push(mapUserDoc(docSnap));
    } catch (error) {
      console.warn('[mapUserDocs] Skipping user doc with unreadable fields:', docSnap.id, error);
    }
  }
  return users;
}
