import type { Lead } from "@/app/types";
import { canSeeHotLeads, type HotLeadProfile } from "./access";
import { HOT_LEADS_ENABLED } from "./flag";
import { isHotLead, isHotOnlyLead, type HotDisplayLead } from "./model";

export type HotPinFilter = "all" | "only" | "hide";
export const HOT_LEAD_LEGEND = "Hot lead (purchased inbound)";

export function hotLeadFilterVisible(
  user: HotLeadProfile | null | undefined,
  enabled = HOT_LEADS_ENABLED,
): boolean {
  return enabled && canSeeHotLeads(user);
}

function stripHot(lead: Lead): Lead {
  if (!isHotLead(lead)) return lead;
  const copy: HotDisplayLead = { ...lead };
  delete copy.hotLead;
  delete copy.hotOnly;
  delete copy.hotLeadId;
  delete copy.hotPin;
  return copy;
}

/** Hide keeps the house pin and drops the halo. Only keeps hot pins. */
export function applyHotFilter(leads: readonly Lead[], filter: HotPinFilter): Lead[] {
  if (filter === "only") return leads.filter((lead) => isHotLead(lead));
  if (filter === "hide") return leads.filter((lead) => !isHotOnlyLead(lead)).map(stripHot);
  return leads as Lead[];
}
