import { stageKnockGps } from "@/app/field/pendingGps";
import type { FieldMutation, PendingMutation } from "@/app/field/types";

/**
 * The tap is already on the draft. stageKnockGps applies an in-window fix
 * or leaves the draft in the pending-GPS state. Area is not a hot-lead verdict:
 * out_of_area is removed so the route's 35 m flag is the only distance result.
 */
export function stageHotKnock(draft: FieldMutation, now = Date.now()): PendingMutation {
  const staged = stageKnockGps(draft as PendingMutation, now);
  const reason = staged.direct?.patch?.gpsUnverifiedReason;
  if (reason !== "out_of_area" || !staged.direct?.patch) return staged;
  const patch = { ...staged.direct.patch };
  delete patch.gpsUnverifiedReason;
  delete patch.gpsVerified;
  return { ...staged, direct: { ...staged.direct, patch } };
}
