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
  private remember(tile: HomeTile) {
    this.memory.delete(tile.tile);
    if (Object.keys(tile.docs).length <= 12000) this.memory.set(tile.tile, tile);
    let records = [...this.memory.values()].reduce((total, value) => total + Object.keys(value.docs).length, 0);
    while (this.memory.size > 12 || records > 12000) {
      const oldest = this.memory.keys().next().value!;
      records -= Object.keys(this.memory.get(oldest)!.docs).length;
      this.memory.delete(oldest);
    }
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
      const circle = viewCircle(view);
      const all = new Map<string, Homeowner>();
      for (const t of tiles.values())
        for (const h of Object.values(t.docs))
          if (
            inView(h, view, 25) &&
            distanceBetween(circle.center, [h.lat, h.lng]) * 1000 <=
              circle.radius + 35
          )
            all.set(h.id, h);
      emit({
        homes: [...all.values()],
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
      for (const tile of plan.keys()) {
        let t = this.memory.get(tile);
        if (!t) t = await this.deps.read(tile);
        tiles.set(tile, t);
        this.remember(t);
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
        await this.deps.save(updated);
        if (result.rawCount >= QUERY_LIMIT) partial = true;
        publish(true);
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
