import { isPermissionDenied } from "./permissionDenied";

export const SCHEDULING_UNAVAILABLE_MESSAGE = "Scheduling isn't available for this account.";

export interface SchedulingSettingsShape {
  schedulingManagerPhone?: string;
  notificationWebhook?: string;
  notificationType?: string;
}

export class SchedulingAccessError extends Error {
  readonly code = "permission-denied";
  constructor() {
    super(SCHEDULING_UNAVAILABLE_MESSAGE);
    this.name = "SchedulingAccessError";
  }
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
 * Read adminSettings once. A permission-denied is remembered for this account
 * and never falls through to a stored webhook or a hardcoded number.
 */
export async function resolveSchedulingRead<T extends SchedulingSettingsShape>(
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

export function schedulingAction<T extends SchedulingSettingsShape>(read: SchedulingRead<T>): {
  sendEnabled: boolean;
  message: string;
  phone: string | null;
  webhook: string | null;
} {
  if (read.status === "denied") {
    return { sendEnabled: false, message: SCHEDULING_UNAVAILABLE_MESSAGE, phone: null, webhook: null };
  }
  const settings = read.status === "ready" ? read.settings : null;
  return {
    sendEnabled: true,
    message: "",
    phone: settings?.schedulingManagerPhone?.trim() || null,
    webhook: settings?.notificationWebhook?.trim() || null,
  };
}

/** Disabled accounts never reach the webhook. Missing settings stay on the existing unconfigured path. */
export function beginSchedulingSend(
  unavailable: boolean,
  action: { sendEnabled: boolean; webhook: string | null },
): "disabled" | "unconfigured" | "send" {
  if (unavailable || !action.sendEnabled) return "disabled";
  if (!action.webhook) return "unconfigured";
  return "send";
}
