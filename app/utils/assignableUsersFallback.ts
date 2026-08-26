import type { Lead, User } from '../types';
import type { Territory } from '../types/territory';

function stubUser(id: string, name: string, color?: string, extra?: Partial<User>): User {
  return {
    id,
    name: name || id,
    email: extra?.email || '',
    color: color || extra?.color || '#6b7280',
    role: extra?.role || 'setter',
    createdAt: extra?.createdAt || new Date(),
    isActive: extra?.isActive !== false,
  };
}

/**
 * Assign To / Filter names when getAllUsers returns [].
 * Uses only data already on the page — no extra lead fetch.
 */
export function buildAssignableUsersFromPageData(
  currentUser: User | null,
  territories: Territory[],
  boundsLeads: Lead[],
): User[] {
  const byId = new Map<string, User>();

  if (currentUser) {
    byId.set(currentUser.id, currentUser);
  }

  for (const territory of territories) {
    if (!territory.userId || byId.has(territory.userId)) continue;
    byId.set(
      territory.userId,
      stubUser(territory.userId, territory.userName, territory.userColor, {
        createdAt: territory.createdAt,
      }),
    );
  }

  for (const lead of boundsLeads) {
    for (const id of [lead.assignedTo, lead.claimedBy]) {
      if (!id || byId.has(id)) continue;
      const named = lead.dispositionHistory?.find(entry => entry.userId === id)?.userName;
      byId.set(id, stubUser(id, named || id));
    }
  }

  return Array.from(byId.values());
}

/**
 * After authenticated getUsersAsync(), retry getAllUsers once if the
 * collection came back empty. getAllUsers must throw on failure so the
 * page can surface it instead of a silent [].
 */
export async function loadUsersWithRosterRetry(
  getUsers: () => Promise<User[]>,
  getAll: () => Promise<User[]>,
): Promise<{ users: User[]; error: string | null }> {
  let users: User[] = [];
  let error: string | null = null;

  try {
    users = await getUsers();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (users.length === 0) {
    try {
      users = await getAll();
      if (users.length > 0) error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return { users, error };
}
