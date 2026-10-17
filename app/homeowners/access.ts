import { isPermissionDenied } from "@/app/utils/permissionDenied";

export const HOMEOWNER_LIMITED_NOTE = "Homeowner details aren't shown for this account.";

const deniedAccounts = new Set<string>();

export function resetHomeownersAccessForTests(): void {
  deniedAccounts.clear();
}

export function homeownersAccessDenied(accountId?: string | null): boolean {
  return deniedAccounts.has(accountId || "");
}

export function markHomeownersAccessDenied(accountId?: string | null): void {
  deniedAccounts.add(accountId || "");
}

export function homeownerFailureMessage(error: unknown): string {
  if (isPermissionDenied(error)) return HOMEOWNER_LIMITED_NOTE;
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";
  return message || "Homeowner records are temporarily unavailable.";
}
