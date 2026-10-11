import type { Lead, User } from '@/app/types';
import type { Homeowner } from './model';

/** A local draft, not a database lead. Selection never writes or performs a lookup. */
export function homeownerVisitDraft(home: Homeowner, user: User, id: string, at = new Date()): Lead {
  return {
    id, name: home.ownerName || '', address: home.address, city: home.municipality,
    state: home.state, zip: '', // Mailing ZIP is not the property's ZIP.
    lat: home.lat, lng: home.lng, status: 'unclaimed', source: 'manually-added',
    setterId: user.id, claimedBy: user.id, claimedAt: at, createdAt: at,
    homeowner: home,
  };
}

export type HomeownerVisit = ReturnType<typeof createHomeownerVisit>;
/** One ID per open draft, one first write (including the outcome), then partial updates.
 * Failed writes retain the same ID and inputs. No imported record is ever modified.
 */
export function createHomeownerVisit(initial: Lead, deps: {
  create: (lead: Lead) => Promise<void>;
  update: (id: string, patch: Partial<Lead>) => Promise<void>;
  active: () => boolean;
  online: () => boolean;
  durableOffline?: boolean;
}) {
  let lead = initial, saved = false, busy = false;
  return {
    get lead() { return lead; },
    get saved() { return saved; },
    async save(patch: Partial<Lead> = {}) {
      if (busy) throw Error('This home is still saving. Please wait.');
      if (!deps.active()) throw Error('Your account changed. Sign in again before saving.');
      if (!deps.durableOffline && !deps.online()) throw Error('Connect to save this home. Your entries stay in this panel; reconnect and try again.');
      busy = true;
      try {
        // Only the originating user creates this draft. A loaded existing visit uses
        // the ordinary LeadDetail path and keeps its ownership and history.
        const clean = Object.fromEntries(Object.entries(patch).filter(([key, value]) =>
          value !== undefined && !['id', 'source', 'setterId', 'homeowner', 'createdAt', 'historicalTerritoryPin', 'historicalSetByName'].includes(key),
        )) as Partial<Lead>;
        const next = { ...lead, ...clean };
        if (saved) await deps.update(lead.id, clean);
        else await deps.create(next);
        lead = next;
        saved = true;
        return lead;
      } finally { busy = false; }
    },
    async prepare() {
      if (!saved) await this.save();
    },
  };
}
