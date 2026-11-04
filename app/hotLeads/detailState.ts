import { hotDispoBlockMessage } from "./copy";
import { hotLeadCallAllowed, hotLeadCanDispo } from "./model";

export type HotLeadDetailAccess = {
  viewOnly: boolean;
  message: string | null;
  showClaim: boolean;
  showRelease: boolean;
  showKnocks: boolean;
  notesReadOnly: boolean;
  showSave: boolean;
  allowCall: boolean;
};

/**
 * View-only when the server says canDispo is false. Absent canDispo stays writable.
 * Manager and admin bypass is the server's canDispo:true. This does not grant one.
 */
export function hotLeadDetailState(input: {
  pin: { canDispo?: boolean; dispoBlock?: string | null; doNotCall?: boolean; claimedBy?: string | null };
  canWrite: boolean;
  caps: { claim: boolean; dispo: boolean };
  userId?: string;
  role?: string;
}): HotLeadDetailAccess {
  const viewOnly = !hotLeadCanDispo(input.pin);
  const mine = !!input.userId && input.pin.claimedBy === input.userId;
  const staffRelease = input.role === "manager" || input.role === "admin";
  return {
    viewOnly,
    message: viewOnly ? hotDispoBlockMessage(input.pin.dispoBlock) : null,
    showClaim: input.canWrite && input.caps.claim && !viewOnly && !input.pin.claimedBy,
    showRelease: input.canWrite && input.caps.claim && !viewOnly && (mine || staffRelease),
    showKnocks: input.canWrite && input.caps.dispo && !viewOnly,
    notesReadOnly: !input.canWrite || viewOnly,
    showSave: input.canWrite && !viewOnly,
    allowCall: hotLeadCallAllowed(input.pin),
  };
}
