import { getCache, type RuntimeCache } from '@vercel/functions';

export type TeamPerfCacheOptions = {
  ttl?: number;
  tags?: string[];
};

export type TeamPerfCache = {
  get: (key: string) => Promise<unknown | null>;
  set: (key: string, value: unknown, options?: TeamPerfCacheOptions) => Promise<void>;
};

type MemoryEntry = {
  value: unknown;
  expiresAt: number;
};

const memory = new Map<string, MemoryEntry>();

const memoryCache: TeamPerfCache = {
  async get(key) {
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  },
  async set(key, value, options) {
    const ttlSec = options?.ttl ?? 60;
    memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  },
};

function adaptRuntimeCache(runtime: RuntimeCache): TeamPerfCache {
  return {
    get: (key) => runtime.get(key),
    set: (key, value, options) => runtime.set(key, value, options),
  };
}

/**
 * Vercel Runtime Cache inside a deployment. Outside Vercel (no VERCEL env)
 * this is a process-local Map so dev and tests still dedupe within the process.
 * getCache() itself also falls back to memory, but it warns; we skip that path
 * off-platform and only call it when the runtime is actually Vercel.
 */
export function getTeamPerfCache(): TeamPerfCache {
  if (process.env.VERCEL) {
    try {
      return adaptRuntimeCache(getCache());
    } catch (error) {
      console.warn('[team-perf] Runtime Cache unavailable, using in-memory Map:', error);
    }
  }
  return memoryCache;
}
