'use client';
import { useEffect, useState } from 'react';
import type { PendingMutation } from '@/app/field/types';

/** Routine background writes have no UI. Only a failed or stalled save needs attention. */
export default function UnsyncedNotice({ drafts, syncing, error, onSync }: {
  drafts: PendingMutation[]; syncing: boolean; error: string; onSync: () => Promise<void>;
}) {
  const oldest = drafts.length ? Math.min(...drafts.map(d => Date.parse(d.createdAt))) : 0;
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!oldest) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, oldest + 30000 - Date.now()));
    return () => clearTimeout(timer);
  }, [oldest]);
  if (!drafts.length) return null;
  const problem = error || drafts.find(d => d.error)?.error;
  const delayed = clock >= oldest + 30000;
  if (!problem && !delayed) return null;
  return <details className="rm-unsynced">
    <summary aria-live="polite">{drafts.length === 1 ? '1 saved change needs attention' : `${drafts.length} saved changes need attention`}</summary>
    <div>
      <p>Your changes are kept on this phone but have not been confirmed by your team’s system. Check your connection and retry.</p>
      {problem && <p role="alert">{problem}</p>}
      <button type="button" disabled={syncing} onClick={() => void onSync()}>
        {syncing ? 'Retrying…' : 'Retry save'}
      </button>
      <a href="/mobile/field-tools/?tab=sync">Review saved actions</a>
    </div>
  </details>;
}
