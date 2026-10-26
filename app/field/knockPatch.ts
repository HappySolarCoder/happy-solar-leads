import type { Lead, User } from '@/app/types';
import type { Disposition } from '@/app/types/disposition';
import { historyGpsFlag } from '@/app/field/directWrites';

/** Same fields/ids as web LeadDetail. Capture the action time before awaiting GPS. */
export function knockPatch(lead: Lead, user: User, signedInUid: string | undefined,
  disposition: Pick<Disposition, 'id' | 'name'>, at: Date, extra: Partial<Lead> = {}): Partial<Lead> {
  if (!signedInUid || user.id !== signedInUid) throw Error('Sign in again before recording a knock.');
  if (!disposition.id || ['claimed', 'unclaimed'].includes(disposition.id)) throw Error('Use claim/unclaim to change ownership.');
  const flag = historyGpsFlag(extra);
  return { ...extra, status: disposition.id, dispositionedAt: at,
    dispositionHistory: [{ disposition: disposition.name, timestamp: at,
      userId: signedInUid, userName: user.name, ...(flag ? { gpsFlag: flag } : {}) },
      ...(lead.dispositionHistory || [])] };
}
