'use client';
import { apiFetch } from '@/app/utils/apiFetch';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import type { Territory } from '@/app/types/territory';
import type { TeamAreaMember } from '@/app/utils/teamAreas';

type Areas = { territories: Territory[]; members: TeamAreaMember[] };
const cache = new Map<string, { at: number; value: Areas }>();
const pending = new Map<string, Promise<Areas>>();
async function readAreas(uid: string): Promise<Areas> {
  const existing = pending.get(uid);
  if (existing) return existing;
  const request = (async () => {
    if (auth?.currentUser?.uid !== uid) throw Error('Sign in to load territories.');
    const token = await auth.currentUser.getIdToken();
    const res = await apiFetch('/api/team-areas?summary=1', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw Error('Territories could not load. Tap Retry areas.');
    const data = await res.json();
    if (auth?.currentUser?.uid !== uid) throw Error('Account changed.');
    const value: Areas = {
      // Boundaries, not the potentially town-sized legacy leadIds arrays.
      territories: (Array.isArray(data.territories) ? data.territories : []).filter((t: any) => !t.archived && Array.isArray(t.polygon) && t.polygon.length >= 3).map((t: Territory) => ({ ...t, leadIds: [] })),
      members: Array.isArray(data.members) ? data.members : [],
    };
    cache.set(uid, { at: Date.now(), value });
    while (cache.size > 2) cache.delete(cache.keys().next().value!);
    return value;
  })().finally(() => pending.delete(uid));
  pending.set(uid, request);
  return request;
}

/** Loading completion is explicit: an empty initial render is not "no territory". */
export function useTeamAreasOverlay(enabled: boolean, userId?: string) {
  const [state, setState] = useState<{ uid?: string; value?: Areas; loading: boolean; error: string }>({ loading: true, error: '' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { if (userId) cache.delete(userId); setAttempt(v => v + 1); }, [userId]);
  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    const saved = cache.get(userId);
    if (saved && Date.now() - saved.at < 30_000) {
      setState({ uid: userId, value: saved.value, loading: false, error: '' });
      return;
    }
    setState({ uid: userId, value: saved?.value, loading: true, error: '' });
    void readAreas(userId).then(value => { if (active) setState({ uid: userId, value, loading: false, error: '' }); })
      .catch(e => { if (active) setState({ uid: userId, loading: false, error: e.message }); });
    return () => { active = false; };
  }, [enabled, userId, attempt]);
  const value = enabled && state.uid === userId ? state.value : undefined;
  return { territories: value?.territories || EMPTY_TERRITORIES, members: value?.members || EMPTY_MEMBERS,
    ready: !!value, loading: enabled && (state.uid !== userId || state.loading), error: state.uid === userId ? state.error : '', retry };
}
const EMPTY_TERRITORIES: Territory[] = [];
const EMPTY_MEMBERS: TeamAreaMember[] = [];
