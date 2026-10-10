"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { auth } from "@/app/utils/firebase";
import { getCurrentAuthUser } from "@/app/utils/auth";
import { apiFetch } from "@/app/utils/apiFetch";
import { mayManageTerritories } from "@/app/utils/territoryManager";
import TerritoryWorkspace, { type TerritoryData } from "./TerritoryWorkspace";
import { MobileLoading } from "../_components/MobileShell";
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
    throw new Error(result.error || "Territories could not be loaded.");
  return result;
}
export default function TerritoriesPage() {
  const router = useRouter(),
    [data, setData] = useState<TerritoryData | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      const user = await getCurrentAuthUser();
      if (!active) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (!mayManageTerritories(user))
        throw new Error(
          "Territory management is available to approved managers and admins."
        );
      const result = await request();
      if (active) setData(result);
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [attempt, router]);
  if (error)
    return (
      <div className="rt-unavailable">
        <h1>Territories</h1>
        <p role="alert">{error}</p>
        <button
          className="rt-primary"
          onClick={() => {
            setError("");
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </button>
        <Link href="/mobile/more">Back to workspace</Link>
      </div>
    );
  return data ? (
    <TerritoryWorkspace initialData={data} request={request} />
  ) : (
    <MobileLoading />
  );
}
