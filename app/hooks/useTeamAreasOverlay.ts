'use client';
import { apiFetch } from '@/app/utils/apiFetch';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/app/utils/firebase';
import { cacheOwnPolygonsFromTeamAreas } from '@/app/field/areaGate';
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
    cacheOwnPolygonsFromTeamAreas(uid, data);
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
    let authRetryUsed = false;
    let unsubAuth: (() => void) | undefined;
    const finish = (value: Areas) => { if (active) setState({ uid: userId, value, loading: false, error: '' }); };
    const fail = (e: unknown) => {
      if (!active) return;
      const message = e instanceof Error ? e.message : '';
      setState({
        uid: userId,
        loading: false,
        error: message === 'Sign in to load territories.' || message === 'Account changed.'
          ? message
          : 'Territories could not load. Tap Retry areas.',
      });
    };
    const load = () => {
      void readAreas(userId).then(finish).catch((e: unknown) => {
        fail(e);
        // One automatic retry after a signed-out read. A later failure does not subscribe again.
        if (!active || authRetryUsed) return;
        if (!(e instanceof Error) || e.message !== 'Sign in to load territories.' || !auth?.onAuthStateChanged) return;
        authRetryUsed = true;
        unsubAuth = auth.onAuthStateChanged((user) => {
          if (!active || user?.uid !== userId) return;
          unsubAuth?.();
          unsubAuth = undefined;
          setState({ uid: userId, value: cache.get(userId)?.value, loading: true, error: '' });
          void readAreas(userId).then(finish).catch(fail);
        });
      });
    };
    load();
    return () => { active = false; unsubAuth?.(); };
  }, [enabled, userId, attempt]);
  const value = enabled && state.uid === userId ? state.value : undefined;
  return { territories: value?.territories || EMPTY_TERRITORIES, members: value?.members || EMPTY_MEMBERS,
    ready: !!value, loading: enabled && (state.uid !== userId || state.loading), error: state.uid === userId ? state.error : '', retry };
}
const EMPTY_TERRITORIES: Territory[] = [];
const EMPTY_MEMBERS: TeamAreaMember[] = [];

/** Territory document ids this rep owns, from the team-areas cache. Empty when areas have not loaded. */
export function cachedTerritoryIds(userId: string): string[] {
  if (!userId) return [];
  const saved = cache.get(userId);
  if (!saved) return [];
  return saved.value.territories.filter((territory) => territory.userId === userId && territory.id).map((territory) => territory.id);
}
