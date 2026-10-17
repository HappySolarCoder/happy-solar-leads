import { isPermissionDenied } from "./permissionDenied";

/** Phone number only. The notification URL stays on the server. */
export interface SchedulingPhoneSettings {
  schedulingManagerPhone?: string;
}

const deniedAccounts = new Set<string>();

export function resetSchedulingAccessForTests(): void {
  deniedAccounts.clear();
}

export function schedulingAccessDenied(uid?: string | null): boolean {
  if (uid == null) return deniedAccounts.size > 0;
  return deniedAccounts.has(uid || "");
}

export type SchedulingRead<T> =
  | { status: "ready"; settings: T }
  | { status: "missing" }
  | { status: "denied" };

/**
 * Read the scheduling phone once. A permission-denied is remembered for this
 * account so the read is not retried. A denied read does not disable Send.
 */
export async function resolveSchedulingRead<T extends SchedulingPhoneSettings>(
  uid: string,
  read: () => Promise<T | null>,
): Promise<SchedulingRead<T>> {
  const account = uid || "";
  if (deniedAccounts.has(account)) return { status: "denied" };
  try {
    const settings = await read();
    if (!settings) return { status: "missing" };
    return { status: "ready", settings };
  } catch (error) {
    if (!isPermissionDenied(error)) return { status: "missing" };
    deniedAccounts.add(account);
    return { status: "denied" };
  }
}

/** Copy the phone string and nothing else from a settings document. */
export function phoneOnly(value: unknown): SchedulingPhoneSettings | null {
  if (!value || typeof value !== "object") return null;
  const phone = (value as SchedulingPhoneSettings).schedulingManagerPhone;
  if (typeof phone !== "string") return { schedulingManagerPhone: "" };
  return { schedulingManagerPhone: phone };
}
