/** Firestore `users.status` once the account owner has asked to be deleted. */
export const DELETION_REQUESTED_STATUS = 'deletion-requested';

export const ADMIN_SELF_DELETE_ERROR = 'admin-accounts-cannot-self-delete';

export function isDeletionRequestedStatus(status: unknown): boolean {
  return status === DELETION_REQUESTED_STATUS;
}

/**
 * Distinct admin-table label. Other statuses return null so Active/Inactive
 * stays a separate manual re-enable control.
 */
export function adminDeletionRequestedLabel(status: unknown): typeof DELETION_REQUESTED_STATUS | null {
  return isDeletionRequestedStatus(status) ? DELETION_REQUESTED_STATUS : null;
}
