import type { User, UserRole } from "@/app/types";
import { isTestAccountUser } from "@/app/utils/testAccount";

const HOT_ROLES = new Set<UserRole>(["closer", "manager", "admin"]);

export type HotLeadProfile = User & {
  deleted?: boolean;
  deletedAt?: unknown;
  deletionPending?: boolean;
  demo?: boolean;
};

/**
 * Demo accounts are synthetic review logins, not a role.
 * A demo id, a demo@ mailbox, team DEMO, or demo:true.
 */
export function isDemoAccount(
  user: { id?: string; email?: string; team?: string; demo?: boolean } | null | undefined,
): boolean {
  if (!user) return false;
  if (user.demo === true) return true;
  if (typeof user.team === "string" && user.team.toUpperCase() === "DEMO") return true;
  const id = (user.id || "").toLowerCase();
  if (id === "demo" || id.startsWith("demo-") || id.startsWith("demo_")) return true;
  const local = (user.email || "").toLowerCase().split("@")[0] || "";
  return local === "demo" || local.startsWith("demo+") || local.startsWith("demo.");
}

/**
 * Closers, managers and admins only. Setters, unknown roles, signed-out
 * users, and inactive or unapproved profiles never see the layer.
 * Test and demo accounts never see it, including testData hot leads.
 * Account `status` is enforced on the server. The client field is free-form
 * metadata, so only explicit inactive values are denied here.
 */
export function canSeeHotLeads(user: HotLeadProfile | null | undefined): boolean {
  if (!user?.id || !user.role || !HOT_ROLES.has(user.role)) return false;
  if (isTestAccountUser(user) || isDemoAccount(user)) return false;
  if (user.isActive === false || user.approved === false) return false;
  if (user.approvalStatus != null && user.approvalStatus !== "approved") return false;
  if (user.deleted === true || user.deletedAt != null || user.deletionPending === true) return false;
  if (user.status === "inactive" || user.status === "deleted" || user.status === "disabled" || user.status === "pending") {
    return false;
  }
  return true;
}
