"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { auth } from "@/app/utils/firebase";
import { apiFetch } from "@/app/utils/apiFetch";

export default function AppointmentSyncPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking the last GHL sync…");

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const token = await auth?.currentUser?.getIdToken();
        if (!token) throw new Error("Sign in to check the connection.");
        const response = await apiFetch("/api/admin/sync-appointments", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Sync status is unavailable.");
        const data = await response.json();
        const date = data.status?.lastSuccessAt
          ? new Date(data.status.lastSuccessAt)
          : null;
        if (active)
          setMessage(
            date && Number.isFinite(date.getTime())
              ? `Last successful sync: ${date.toLocaleString()}`
              : "No successful sync has been recorded yet.",
          );
      } catch {
        if (active)
          setMessage(
            "Sync status is unavailable. Check the connection before relying on outcomes.",
          );
      }
    }
    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function sync() {
    setBusy(true);
    try {
      const token = await auth?.currentUser?.getIdToken();
      if (!token) throw new Error("Sign in again to sync outcomes.");
      const response = await apiFetch("/api/admin/sync-appointments", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 429)
        throw new Error(
          "A sync ran recently. Please wait a few minutes before trying again.",
        );
      if (response.status === 503)
        throw new Error(
          "The GHL connection has not been configured on the server yet.",
        );
      if (!response.ok)
        throw new Error(
          "Could not sync outcomes. Check your connection or contact your administrator.",
        );
      const data = await response.json();
      setMessage(
        `Sync complete. ${Number(data.updated || 0)} lead records updated. Assigned reps receive the changes automatically.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sync failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rm-sync-panel">
      <h2>Appointment outcome connection</h2>
      <p role="status">{message}</p>
      <button className="rm-primary" onClick={sync} disabled={busy}>
        <RefreshCw size={17} className={busy ? "rm-spin" : undefined} />
        {busy ? "Syncing outcomes…" : "Sync GHL outcomes"}
      </button>
      <small>
        Updates shared appointment results in Raydar. Existing assignments and
        knock dispositions stay unchanged.
      </small>
    </section>
  );
}
