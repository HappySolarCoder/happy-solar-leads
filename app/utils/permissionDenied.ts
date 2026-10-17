/** Firestore client denials use either code, depending on the SDK path. */
export function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code || "");
  return code === "permission-denied" || code.endsWith("/permission-denied");
}
