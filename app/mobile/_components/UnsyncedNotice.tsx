'use client';
import type { PendingMutation } from '@/app/field/types';

export default function UnsyncedNotice({ drafts, syncing, error, onSync }: {
  drafts: PendingMutation[]; syncing: boolean; error: string; onSync: () => Promise<void>;
}) {
  if (!drafts.length) return null;
  const problem = error || drafts.find(d => d.error)?.error;
  return <details className="rm-unsynced">
    <summary aria-live="polite">{drafts.length} unsynced{syncing ? ' · Syncing…' : ''}</summary>
    <div>
      <p>Saved on this phone. Reporting updates after Firestore confirms sync.</p>
      {problem && <p role="alert">{problem}</p>}
      <button type="button" disabled={syncing} onClick={() => void onSync()}>
        {syncing ? 'Syncing…' : 'Retry sync'}
      </button>
      <a href="/mobile/field-tools/?tab=sync">Review saved actions</a>
    </div>
  </details>;
}
