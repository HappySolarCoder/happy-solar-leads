import type { DispoBlock } from "./model";

/** Contract v2. The server picks the block. Missing or unknown uses outside_territory. */
export const HOT_DISPO_BLOCK_COPY: Record<DispoBlock, string> = {
  outside_territory:
    "This 3PL lead is outside your assigned territory. You can view it, but you can't knock, claim or add notes.",
  no_territory:
    "You don't have an assigned territory, so 3PL leads are view-only. Ask your manager to assign one.",
  territory_unknown:
    "We couldn't confirm your territory, so this 3PL lead is view-only right now.",
  no_coords: "This 3PL lead has no map location, so it's view-only.",
};

export const HOT_VIEW_ONLY_LEGEND = "3PL lead — view only";

/** Recovery list. Dismiss only. The draft is not retried. */
export const HOT_TERRITORY_RECOVERY_LABEL = "Not saved: outside your territory";

export function hotDispoBlockMessage(block: string | null | undefined): string {
  if (block && Object.prototype.hasOwnProperty.call(HOT_DISPO_BLOCK_COPY, block)) {
    return HOT_DISPO_BLOCK_COPY[block as DispoBlock];
  }
  return HOT_DISPO_BLOCK_COPY.outside_territory;
}
