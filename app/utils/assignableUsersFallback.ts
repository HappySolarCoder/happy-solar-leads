import { Lead, User } from '@/app/types';
import { Territory } from '@/app/types/territory';

/** Firebase uid / users doc id. Never treat a display name as assignable. */
export function isAssignableUserId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const value = id.trim();
  if (!value) return false;
  // Names like "Evan Test Setter" must not become option values / assignedTo.
  if (/\s/.test(value)) return false;
  return true;
}

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
 * Skips rows without a uid. Never uses a display name as id.
 */
export function buildAssignableUsersFromPageData(
  currentUser: User | null,
  territories: Territory[],
  boundsLeads: Lead[],
): User[] {
  const byId = new Map<string, User>();

  const currentId = currentUser && isAssignableUserId(currentUser.id) ? currentUser.id : '';
  if (currentUser && currentId) {
    byId.set(currentId, { ...currentUser, id: currentId });
  }

  for (const territory of territories) {
    if (!isAssignableUserId(territory.userId) || byId.has(territory.userId)) continue;
    byId.set(
      territory.userId,
      stubUser(territory.userId, territory.userName, territory.userColor, {
        createdAt: territory.createdAt,
      }),
    );
  }

  for (const lead of boundsLeads) {
    for (const id of [lead.assignedTo, lead.claimedBy]) {
      if (!isAssignableUserId(id) || byId.has(id)) continue;
      const named = lead.dispositionHistory?.find(entry => entry.userId === id)?.userName;
      byId.set(id, stubUser(id, named || id));
    }
  }

  return Array.from(byId.values());
}
