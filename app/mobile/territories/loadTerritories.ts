import { mayManageTerritories } from "@/app/utils/territoryManager";
import type { TerritoryData } from "./TerritoryWorkspace";

/** Same bound as the mobile session profile stage, applied only to auth readiness. */
export const AUTH_READY_TIMEOUT_MS = 12_000;
/** Read-only summary GET. Long enough for a cold route, short enough to retry. */
export const TERRITORIES_LOAD_TIMEOUT_MS = 20_000;

export const SIGN_IN_TIMEOUT_MESSAGE =
  "Sign-in is taking too long to respond. Try again or reload the app.";
export const TERRITORIES_TIMEOUT_MESSAGE =
  "Territories are taking too long to load. Check your connection, then try again.";
export const SIGN_IN_AGAIN_MESSAGE = "Sign in again to manage territories.";
export const MANAGER_ONLY_MESSAGE =
  "Territory management is available to approved managers and admins.";
export const TERRITORY_SERVICE_UNAVAILABLE_MESSAGE =
  "The territory service is unavailable. Please try again.";
export const TERRITORY_SERVER_UPDATE_MESSAGE =
  "Territory management is not enabled on your company server yet. Your administrator needs to finish the server update.";

export const TERRITORY_SUMMARY_PATH = "/api/territory-management?summary=1";

export type TerritoryHttpResult = {
  status: number;
  contentType: string | null;
  /** Parsed JSON, or null when the body was missing or not JSON. */
  body: unknown;
};

export type TerritoryTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type LoadTerritoriesDeps = {
  authReady: () => Promise<void>;
  currentUser: () => unknown;
  /** GET /api/territory-management?summary=1. Must not read Firestore. */
  request: () => Promise<TerritoryHttpResult>;
  timers?: TerritoryTimers;
};

export type TerritoryLoadResult =
  | { type: "redirect"; href: "/login" }
  | { type: "ready"; data: TerritoryData }
  | { type: "error"; message: string; signIn: boolean };

const defaultTimers: TerritoryTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string, timers: TerritoryTimers): Promise<T> {
  let handle: unknown;
  const timeout = new Promise<never>((_, reject) => {
    handle = timers.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => timers.clearTimeout(handle));
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function jsonContent(contentType: string | null) {
  return Boolean(contentType?.includes("application/json"));
}

function serverError(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" ? error : undefined;
}

export async function territoryHttpResult(response: {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}): Promise<TerritoryHttpResult> {
  const contentType = response.headers.get("content-type");
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, contentType, body };
}

export function interpretTerritoryGet(response: TerritoryHttpResult): TerritoryLoadResult {
  if (response.status === 404 && !jsonContent(response.contentType)) {
    return { type: "error", message: TERRITORY_SERVER_UPDATE_MESSAGE, signIn: false };
  }
  if (response.status === 401) {
    return { type: "error", message: SIGN_IN_AGAIN_MESSAGE, signIn: true };
  }
  if (response.status === 403) {
    const error = serverError(response.body);
    return {
      type: "error",
      message: error && error.trim() ? error : MANAGER_ONLY_MESSAGE,
      signIn: false,
    };
  }
  if (response.status < 200 || response.status >= 300) {
    const error = serverError(response.body);
    const message = error
      ? error
      : response.body && typeof response.body === "object"
        ? `Territories could not be loaded (HTTP ${response.status}).`
        : TERRITORY_SERVICE_UNAVAILABLE_MESSAGE;
    return { type: "error", message, signIn: false };
  }
  if (!response.body || typeof response.body !== "object" || Array.isArray(response.body)) {
    return { type: "error", message: TERRITORY_SERVICE_UNAVAILABLE_MESSAGE, signIn: false };
  }
  const data = response.body as TerritoryData;
  if (!mayManageTerritories(data.actor || {})) {
    return { type: "error", message: MANAGER_ONLY_MESSAGE, signIn: false };
  }
  return { type: "ready", data };
}

/**
 * Auth-only gate, then the summary GET. The territory route already checks
 * the caller with the admin SDK, so this page must not read users/{uid}.
 */
export async function loadTerritories(deps: LoadTerritoriesDeps): Promise<TerritoryLoadResult> {
  const timers = deps.timers ?? defaultTimers;
  try {
    await withTimeout(deps.authReady(), AUTH_READY_TIMEOUT_MS, SIGN_IN_TIMEOUT_MESSAGE, timers);
  } catch (error) {
    return { type: "error", message: errorText(error, SIGN_IN_TIMEOUT_MESSAGE), signIn: false };
  }
  if (!deps.currentUser()) return { type: "redirect", href: "/login" };
  try {
    const response = await withTimeout(
      deps.request(),
      TERRITORIES_LOAD_TIMEOUT_MS,
      TERRITORIES_TIMEOUT_MESSAGE,
      timers,
    );
    return interpretTerritoryGet(response);
  } catch (error) {
    return { type: "error", message: errorText(error, TERRITORIES_TIMEOUT_MESSAGE), signIn: false };
  }
}
