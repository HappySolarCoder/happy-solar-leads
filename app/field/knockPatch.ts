import type { Lead, User } from '@/app/types';
import type { Disposition } from '@/app/types/disposition';

/** Same fields/ids as web LeadDetail. Capture the action time before awaiting GPS. */
export function knockPatch(lead: Lead, user: User, signedInUid: string | undefined,
  disposition: Pick<Disposition, 'id' | 'name'>, at: Date, extra: Partial<Lead> = {}): Partial<Lead> {
  if (!signedInUid || user.id !== signedInUid) throw Error('Sign in again before recording a knock.');
  if (!disposition.id || ['claimed', 'unclaimed'].includes(disposition.id)) throw Error('Use claim/unclaim to change ownership.');
  return { ...extra, status: disposition.id, dispositionedAt: at,
    dispositionHistory: [{ disposition: disposition.name, timestamp: at,
      userId: signedInUid, userName: user.name }, ...(lead.dispositionHistory || [])] };
}
