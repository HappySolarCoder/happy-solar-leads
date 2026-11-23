// Firestore adapters for the Empower bump.
// - Receipts live in the Raydar database: empowerBumpReceipts/{uid}_{draftId}
//   (server-only, default-deny in firestore.rules, one doc per draft, no list endpoint).
// - Bump events live in the GHL warehouse database that ghl-sync reads:
//   empower_bump_events_v1/{draftId}. Create-only; ghl-sync posts the
//   "Empower Plus bump" Discord message from it (key bump:{draftId}).

export const EMPOWER_BUMP_RECEIPTS = 'empowerBumpReceipts';
export const EMPOWER_BUMP_EVENTS = 'empower_bump_events_v1';
/** An in-flight claim older than this is treated as abandoned (route maxDuration is 60s). */
export const EMPOWER_BUMP_CLAIM_STALE_MS = 120_000;

export type DocSnapLike = {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
  updateTime?: unknown;
};

export type DocRefLike = {
  get: () => Promise<DocSnapLike>;
  create: (data: Record<string, unknown>) => Promise<unknown>;
  set: (data: Record<string, unknown>) => Promise<unknown>;
  update: (data: Record<string, unknown>, precondition?: { lastUpdateTime?: unknown }) => Promise<unknown>;
  delete: () => Promise<unknown>;
};

export type FirestoreLike = {
  collection: (name: string) => { doc: (id: string) => DocRefLike };
};

export function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === '6' || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

export type EmpowerBumpOutcome = 'created' | 'updated';

export type EmpowerBumpReceipt = {
  draftId: string;
  uid: string;
  leadId: string;
  actedAt: string;
  contactId: string;
  opportunityId: string;
  outcome: EmpowerBumpOutcome;
};

export type ClaimResult =
  | { kind: 'claimed' }
  | { kind: 'replay'; receipt: EmpowerBumpReceipt }
  | { kind: 'in_flight' }
  | { kind: 'draft_reused' };

export type EmpowerBumpReceiptStore = {
  claim: (input: { uid: string; draftId: string; leadId: string; nowMs: number }) => Promise<ClaimResult>;
  complete: (receipt: EmpowerBumpReceipt, nowMs: number) => Promise<void>;
  release: (uid: string, draftId: string) => Promise<void>;
};

export function receiptId(uid: string, draftId: string): string {
  return `${uid}_${draftId}`;
}

function toReceipt(data: Record<string, unknown>): EmpowerBumpReceipt | null {
  if (data.status !== 'done') return null;
  const outcome = data.outcome === 'created' || data.outcome === 'updated' ? data.outcome : null;
  if (!outcome || typeof data.opportunityId !== 'string' || typeof data.contactId !== 'string') return null;
  return {
    draftId: String(data.draftId ?? ''),
    uid: String(data.uid ?? ''),
    leadId: String(data.leadId ?? ''),
    actedAt: String(data.actedAt ?? ''),
    contactId: data.contactId,
    opportunityId: data.opportunityId,
    outcome,
  };
}

export function createReceiptStore(db: FirestoreLike, staleMs = EMPOWER_BUMP_CLAIM_STALE_MS): EmpowerBumpReceiptStore {
  const ref = (uid: string, draftId: string) => db.collection(EMPOWER_BUMP_RECEIPTS).doc(receiptId(uid, draftId));

  return {
    async claim({ uid, draftId, leadId, nowMs }) {
      const doc = ref(uid, draftId);
      const claim = { status: 'in_flight', uid, draftId, leadId, claimedAtMs: nowMs };
      try {
        await doc.create(claim);
        return { kind: 'claimed' };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      const snap = await doc.get();
      const data = snap.data() ?? {};
      if (data.leadId !== undefined && data.leadId !== leadId) return { kind: 'draft_reused' };
      const receipt = toReceipt(data);
      if (receipt) return { kind: 'replay', receipt };
      const claimedAt = typeof data.claimedAtMs === 'number' ? data.claimedAtMs : 0;
      if (nowMs - claimedAt < staleMs || snap.updateTime === undefined) return { kind: 'in_flight' };
      // Abandoned claim (crashed instance). Take it over only if nobody else did.
      try {
        await doc.update(claim, { lastUpdateTime: snap.updateTime });
        return { kind: 'claimed' };
      } catch {
        return { kind: 'in_flight' };
      }
    },
    async complete(receipt, nowMs) {
      await ref(receipt.uid, receipt.draftId).set({
        ...receipt,
        status: 'done',
        createdAt: new Date(nowMs),
        createdAtMs: nowMs,
      });
    },
    async release(uid, draftId) {
      await ref(uid, draftId).delete();
    },
  };
}

/** Event doc for ghl-sync. No phone, no email, no income. */
export type EmpowerBumpEvent = {
  draftId: string;
  uid: string;
  leadId: string;
  opportunityId: string;
  contactId: string;
  outcome: EmpowerBumpOutcome;
  /** true when this bump created the Empower+ opportunity (ghl-sync also reserves opp_created:{id}). */
  opportunityCreated: boolean;
  name: string;
  town: string;
  repName: string;
  householdSize: number;
  estimatedTierLabel: string;
  assistanceYes: boolean;
  actedAt: string;
};

export type EmpowerBumpEventStore = {
  /** Create-only. Returns false when the event already exists (replay after a lost receipt). */
  createEvent: (event: EmpowerBumpEvent, nowMs: number) => Promise<boolean>;
};

export function createEventStore(db: FirestoreLike): EmpowerBumpEventStore {
  return {
    async createEvent(event, nowMs) {
      try {
        await db.collection(EMPOWER_BUMP_EVENTS).doc(event.draftId).create({
          ...event,
          status: 'pending',
          createdAt: new Date(nowMs),
          createdAtMs: nowMs,
          source: 'raydar-empower-bump',
        });
        return true;
      } catch (error) {
        if (isAlreadyExists(error)) return false;
        throw error;
      }
    },
  };
}
