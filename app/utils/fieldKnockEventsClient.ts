import { auth } from '@/app/utils/firebase';
import { knockLedgerKey } from '@/app/utils/fieldKnockEvents';
import { setFieldKnockEventLedger } from '@/app/utils/webKnockCounts';

const TTL_MS = 60_000;
let loadedAt = 0;
let loadedSince = Infinity;

/**
 * Loads counts-only knocks for the viewer's scope into the shared web counters.
 * Never throws: on any failure the counters stay exactly as they were (history only).
 * Call before setting the leads that the counters read, so the first render includes them.
 */
export async function loadFieldKnockEventLedger(sinceMs?: number): Promise<void> {
  try {
    const want = sinceMs ?? Date.now() - 62 * 24 * 60 * 60 * 1000;
    if (Date.now() - loadedAt < TTL_MS && want >= loadedSince) return;
    const token = await auth?.currentUser?.getIdToken();
    if (!token) return;
    const res = await fetch(`/api/field-knock-events?since=${Math.max(0, Math.floor(want))}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json = (await res.json()) as { events?: Array<{ uid: string; leadId: string; at: number; dispositionId: string }> };
    const rows = Array.isArray(json.events) ? json.events : [];
    setFieldKnockEventLedger(
      rows.map((row) => ({
        key: knockLedgerKey(row.leadId, row.uid, row.dispositionId, row.at),
        leadId: row.leadId,
        userId: row.uid,
        at: row.at,
        dispositionId: row.dispositionId,
      })),
    );
    loadedAt = Date.now();
    loadedSince = want;
  } catch (error) {
    console.error('Field knock events load failed:', error);
  }
}
