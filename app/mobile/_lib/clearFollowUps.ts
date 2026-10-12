import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '@/app/utils/firebase';
import { isDeviceOnline } from '@/app/utils/connectivity';
import type { Lead } from '@/app/types';
import { followUpCleanupPatch, isOwnFollowUp } from './followUps';

export async function clearFollowUps(uid: string, leads: Lead[], onRemoved: (ids: string[]) => void) {
  const database = db;
  if (!database) throw Error('Firestore is not configured. No follow-ups were removed.');
  const check = () => {
    if (!uid || auth?.currentUser?.uid !== uid) throw Error('Your account changed. Sign in again.');
    if (!isDeviceOnline()) throw Error('Connect to remove follow-ups across your devices.');
  };
  check();
  const targets = [...new Map(leads.map(lead => [lead.id, lead])).values()];
  if (targets.some(lead => !isOwnFollowUp(lead, uid))) throw Error('You can only remove your own follow-ups.');
  let skipped = 0;
  // Bounded transactions; no collection scan, background listener or new schema.
  for (let offset = 0; offset < targets.length; offset += 50) {
    check();
    const chunk = targets.slice(offset, offset + 50);
    const removed = await runTransaction(database, async tx => {
      check();
      const refs = chunk.map(lead => doc(database, 'leads', lead.id));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      check();
      const ids: string[] = [];
      snapshots.forEach((snapshot, i) => {
        if (!snapshot.exists()) return;
        const current = { ...snapshot.data(), id: snapshot.id } as Lead;
        const patch = followUpCleanupPatch(current, chunk[i], uid);
        if (!patch) return; // A reassigned/rescheduled reminder must survive.
        tx.update(refs[i], patch);
        ids.push(chunk[i].id);
      });
      return ids;
    });
    skipped += chunk.length - removed.length;
    onRemoved(removed);
  }
  return { skipped };
}
