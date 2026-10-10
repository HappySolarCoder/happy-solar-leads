"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentAuthUser } from "@/app/utils/auth";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";
import { MobileLoading } from "../../_components/MobileShell";
import UsersWorkspace, { type UsersData } from "./UsersWorkspace";
async function request<T = UsersData>(
  body?: Record<string, unknown>
): Promise<T> {
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Sign in again to manage users.");
  const response = await apiFetch("/api/mobile-user-management", {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (
    response.status === 404 &&
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "Manage Users needs the v10 server update. Deploy the backend update, then tap Try again."
    );
  const result = await response
    .json()
    .catch(() => ({ error: "The user service is unavailable. Please retry." }));
  if (!response.ok) throw new Error(result.error || "Could not manage users.");
  return result;
}
export default function UsersPage() {
  const [data, setData] = useState<UsersData | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      const user = await getCurrentAuthUser();
      if (!active) return;
      if (user?.role !== "admin")
        throw new Error("Sign in with an admin account to manage users.");
      const result = await request();
      if (active) setData(result);
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (error)
    return (
      <div className="rt-unavailable">
        <h1>Manage Users</h1>
        <p role="alert">{error}</p>
        <button
          onClick={() => {
            setError("");
            setAttempt((x) => x + 1);
          }}
        >
          Try again
        </button>
        <Link href="/mobile/workspace">Back to workspace</Link>
      </div>
    );
  return data ? (
    <UsersWorkspace initialData={data} request={request} />
  ) : (
    <MobileLoading />
  );
}
