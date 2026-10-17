import type { User } from "@/app/types";
import { isPermissionDenied } from "./permissionDenied";

const deniedAccounts = new Set<string>();

export function resetDirectoryDenialForTests(): void {
  deniedAccounts.clear();
}

/** True after this account's user-list query was denied. Other accounts are unaffected. */
export function directoryAccessLimited(uid?: string | null): boolean {
  if (uid == null) return deniedAccounts.size > 0;
  return deniedAccounts.has(uid);
}

/**
 * List the users collection. On permission-denied, remember it for this account
 * and return only that account's own document. A later call does not list again.
 * Other failures still throw so screens can show a connection error.
 */
export async function readUserDirectory(
  uid: string,
  deps: {
    listUsers: () => Promise<User[]>;
    ownUser: () => Promise<User | null>;
  },
): Promise<User[]> {
  const account = uid || "";
  if (deniedAccounts.has(account)) {
    const own = await deps.ownUser().catch(() => null);
    return own ? [own] : [];
  }
  try {
    return await deps.listUsers();
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    deniedAccounts.add(account);
    const own = await deps.ownUser().catch(() => null);
    return own ? [own] : [];
  }
}
