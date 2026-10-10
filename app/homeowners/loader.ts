import { distanceBetween } from "geofire-common";
import {
  applyRead,
  inView,
  MAX_VIEW_QUERIES,
  MAX_VIEW_READS,
  missingRanges,
  planRanges,
  QUERY_LIMIT,
  viewCircle,
  type Homeowner,
  type HomeTile,
  type Range,
  type View,
} from "./model";
export type HomeownerState = {
  homes: Homeowner[];
  loading: boolean;
  offline: boolean;
  partial: boolean;
  zoomIn: boolean;
  error: string;
  reads: number;
  queries: number;
};
export const EMPTY_HOMES: HomeownerState = {
  homes: [],
  loading: false,
  offline: false,
  partial: false,
  zoomIn: false,
  error: "",
  reads: 0,
  queries: 0,
};
type Dependencies = {
  read: (tile: string) => Promise<HomeTile>;
  save: (tile: HomeTile) => Promise<void>;
  fetch: (
    r: Range,
    zoom: number,
  ) => Promise<{ docs: Homeowner[]; rawCount: number }>;
  online: () => boolean;
};
/** One serial worker per account. Pan/zoom cancels queued work, not already-billed in-flight reads. */
export class HomeownerLoader {
  private sequence = 0;
  private running = false;
  private pending?: {
    view: View;
    emit: (s: HomeownerState) => void;
    seq: number;
  };
  private memory = new Map<string, HomeTile>();
  private cacheReads = new Map<string, Promise<HomeTile>>();
  private indexed = new WeakMap<HomeTile, Homeowner[]>();
  private visible: Homeowner[] = [];
  private memoryRecords = 0;
  private records(tile: HomeTile) {
    let docs = this.indexed.get(tile);
    if (!docs) {
      docs = Object.values(tile.docs).sort((a, b) => a.lat - b.lat);
      this.indexed.set(tile, docs);
    }
    return docs;
  }
  private remember(tile: HomeTile) {
    const old = this.memory.get(tile.tile);
    if (old) this.memoryRecords -= this.records(old).length;
    this.memory.delete(tile.tile);
    const count = this.records(tile).length;
    if (count <= 12000) {
      this.memory.set(tile.tile, tile);
      this.memoryRecords += count;
    }
    while (this.memory.size > 12 || this.memoryRecords > 12000) {
      const oldest = this.memory.keys().next().value!;
      this.memoryRecords -= this.records(this.memory.get(oldest)!).length;
      this.memory.delete(oldest);
    }
  }
  private cached(tile: string): Promise<HomeTile> {
    const existing = this.memory.get(tile);
    if (existing) return Promise.resolve(existing);
    let pending = this.cacheReads.get(tile);
    if (!pending) {
      pending = this.deps.read(tile).then(saved => {
        // A newer in-flight network result wins over an older disk snapshot.
        const current = this.memory.get(tile) || saved;
        this.remember(current);
        return current;
      }).finally(() => this.cacheReads.delete(tile));
      this.cacheReads.set(tile, pending);
    }
    return pending;
  }
  private visibleHomes(tiles: Iterable<HomeTile>, view: View) {
    const circle = viewCircle(view), all = new Map<string, Homeowner>();
    const south = view.south - 25 / 111000, north = view.north + 25 / 111000;
    for (const tile of tiles) {
      const docs = this.records(tile);
      let lo = 0, hi = docs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (docs[mid].lat < south) lo = mid + 1; else hi = mid;
      }
      for (let i = lo; i < docs.length && docs[i].lat <= north; i++) {
        const h = docs[i];
        if (inView(h, view, 25) && distanceBetween(circle.center, [h.lat, h.lng]) * 1000 <= circle.radius + 35)
          all.set(h.id, h);
      }
    }
    const homes = [...all.values()];
    // Loading/status-only updates must not repeat matching and pin reconciliation.
    if (homes.length !== this.visible.length || homes.some((h, i) => h !== this.visible[i]))
      this.visible = homes;
    return this.visible;
  }
  constructor(private deps: Dependencies) {}
  cancel() {
    this.sequence++;
    this.pending = undefined;
  }
  request(view: View, emit: (s: HomeownerState) => void) {
    this.pending = { view, emit, seq: ++this.sequence };
    void this.run();
  }
  /** Immediate memory, then saved disk tiles. Never starts a Firestore request. */
  async preview(view: View, emit: (s: HomeownerState) => void) {
    this.pending = undefined;
    const seq = ++this.sequence, plan = planRanges(view);
    const active = () => seq === this.sequence;
    if (!plan.size) {
      emit({ ...EMPTY_HOMES, offline: !this.deps.online(), zoomIn: true });
      return;
    }
    const tiles = new Map<string, HomeTile>();
    const publish = () => {
      if (!active()) return;
      let missing = tiles.size < plan.size, partial = false;
      for (const [key, ranges] of plan) {
        const tile = tiles.get(key);
        if (!tile) continue;
        const remaining = missingRanges(tile, ranges, view.zoom);
        missing ||= remaining.ranges.length > 0;
        partial ||= remaining.dense;
      }
      emit({ ...EMPTY_HOMES, homes: this.visibleHomes(tiles.values(), view),
        offline: !this.deps.online(), loading: missing && this.deps.online(), partial });
    };
    for (const key of plan.keys()) {
      const tile = this.memory.get(key);
      if (tile) tiles.set(key, tile);
    }
    publish();
    const keys = [...plan.keys()].filter(key => !tiles.has(key));
    try {
      // A handful of local reads in parallel; remote reads remain strictly serial.
      for (let i = 0; i < keys.length && active(); i += 4) {
        await Promise.all(keys.slice(i, i + 4).map(async key => tiles.set(key, await this.cached(key))));
        publish();
      }
    } catch {
      // The normal load reports cache errors. Keep already-visible homes here.
    }
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = undefined;
        await this.load(job);
      }
    } finally {
      this.running = false;
    }
  }
  private async load({
    view,
    emit,
    seq,
  }: {
    view: View;
    emit: (s: HomeownerState) => void;
    seq: number;
  }) {
    const active = () => seq === this.sequence;
    const plan = planRanges(view);
    let reads = 0,
      queries = 0,
      error = "",
      partial = false;
    if (!plan.size) {
      if (active())
        emit({ ...EMPTY_HOMES, offline: !this.deps.online(), zoomIn: true });
      return;
    }
    const tiles = new Map<string, HomeTile>();
    const publish = (loading: boolean) => {
      if (!active()) return;
      emit({
        homes: this.visibleHomes(tiles.values(), view),
        loading,
        offline: !this.deps.online(),
        partial,
        zoomIn: false,
        error,
        reads,
        queries,
      });
    };
    try {
      const keys = [...plan.keys()];
      for (let i = 0; i < keys.length && active(); i += 4) {
        await Promise.all(keys.slice(i, i + 4).map(async key => tiles.set(key, await this.cached(key))));
      }
      if (!active()) return;
      const work: { tile: string; r: Range }[] = [];
      for (const [key, ranges] of plan) {
        const missing = missingRanges(tiles.get(key)!, ranges, view.zoom);
        partial ||= missing.dense;
        for (const r of missing.ranges) work.push({ tile: key, r });
      }
      publish(this.deps.online() && work.length > 0);
      for (const { tile, r } of work) {
        if (!active() || !this.deps.online()) break;
        if (
          queries >= MAX_VIEW_QUERIES ||
          reads + QUERY_LIMIT > MAX_VIEW_READS
        ) {
          partial = true;
          break;
        }
        const result = await this.deps.fetch(r, view.zoom);
        queries++;
        reads += Math.max(1, result.rawCount);
        const updated = applyRead(
          tiles.get(tile)!,
          r,
          result.docs,
          result.rawCount,
          view.zoom,
        );
        tiles.set(tile, updated);
        this.remember(updated);
        // Store all bounded results, including geohash false positives. Filter only at render time.
        // This is essential: a coverage receipt cannot discard homes outside the old viewport.
        if (result.rawCount >= QUERY_LIMIT) partial = true;
        publish(true);
        // Show results before waiting on device storage. Persist before another remote query.
        await this.deps.save(updated);
      }
    } catch (e) {
      const x = e as { code?: string; message?: string };
      if (this.deps.online())
        error =
          x.code === "permission-denied"
            ? "Homeowner access is not enabled for this account."
            : x.message || "Homeowner records are temporarily unavailable.";
    }
    publish(false);
  }
}
