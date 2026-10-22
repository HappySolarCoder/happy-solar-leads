"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";
import { MOBILE_BUILD_LABEL } from "../_lib/startupDiagnostics";
import TerritoryWorkspace, { type TerritoryData } from "./TerritoryWorkspace";
import { MobileLoading } from "../_components/MobileShell";
import {
  loadTerritories,
  territoryHttpResult,
  TERRITORY_SUMMARY_PATH,
  type TerritoryHttpResult,
  type TerritoryLoadResult,
} from "./loadTerritories";

async function request<T = TerritoryData>(
  body?: Record<string, unknown>
): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to manage territories.");
  const response = await apiFetch(body ? "/api/territory-management" : "/api/territory-management?summary=1", {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 404 && !response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Territory management is not enabled on your company server yet. Your administrator needs to finish the server update."
    );
  const result = await response
    .json()
    .catch(() => ({
      error: "The territory service is unavailable. Please try again.",
    }));
  if (!response.ok)
    throw Object.assign(new Error(result.error || `Territories could not be loaded (HTTP ${response.status}).`), {status:response.status});
  return result;
}

async function summaryResponse(): Promise<TerritoryHttpResult> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) return { status: 401, contentType: "application/json", body: null };
  const response = await apiFetch(TERRITORY_SUMMARY_PATH, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return territoryHttpResult(response);
}

export default function TerritoriesPage() {
  const router = useRouter(),
    [data, setData] = useState<TerritoryData | null>(null),
    [error, setError] = useState<Extract<TerritoryLoadResult, { type: "error" }> | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void loadTerritories({
      authReady: () => (auth ? auth.authStateReady() : Promise.resolve()),
      currentUser: () => auth?.currentUser ?? null,
      request: summaryResponse,
    }).then((outcome) => {
      if (!active) return;
      if (outcome.type === "redirect") {
        router.replace(outcome.href);
        return;
      }
      if (outcome.type === "error") {
        setError(outcome);
        return;
      }
      if (outcome.type === "ready") setData(outcome.data);
    });
    return () => {
      active = false;
    };
  }, [attempt, router]);
  if (error)
    return (
      <div className="rt-unavailable">
        <h1>Territories</h1>
        <p role="alert">{error.message}</p>
        {error.signIn ? (
          <button type="button" className="rt-primary" onClick={() => router.push("/login")}>
            Sign in
          </button>
        ) : null}
        <button
          type="button"
          className={error.signIn ? undefined : "rt-primary"}
          onClick={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
        <small className="rt-help">{MOBILE_BUILD_LABEL}</small>
        <Link href="/mobile/more">Back to workspace</Link>
      </div>
    );
  return data ? (
    <TerritoryWorkspace initialData={data} request={request} />
  ) : (
    <MobileLoading />
  );
}
