"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DISPOSITIONS } from "@/app/types/disposition";
import type { User } from "@/app/types";
import { useOptionalMobileData } from "@/app/mobile/_components/MobileDataProvider";
import { getLocation } from "@/app/utils/geolocation";
import { DO_NOT_CALL_WARNING, hotCapabilities, hotLeadAfterDispo, hotLeadCallAllowed, noteHotDispo, type HotLeadPin } from "./model";
import {
  HOT_LEAD_OLD_SERVER_NOTICE,
  HOT_LEAD_OWNED_MESSAGE,
  captureHotKnock,
  hotLeadParkNotice,
  queueHotClaim,
  queueHotNotes,
} from "./save";

const KNOCKS = DEFAULT_DISPOSITIONS.filter((row) => row.countsAsDoorKnock && row.id !== "claimed" && row.id !== "unclaimed");

function ownedCopy(pin: HotLeadPin): string | null {
  if (!pin.claimedBy) return null;
  return pin.claimedByName ? `${HOT_LEAD_OWNED_MESSAGE} (${pin.claimedByName})` : HOT_LEAD_OWNED_MESSAGE;
}

export function HotLeadDetail({
  pin: initial,
  user,
  variant = "panel",
  onClose,
}: {
  pin: HotLeadPin;
  user: User | null;
  variant?: "panel" | "section";
  onClose?: () => void;
}) {
  const mobile = useOptionalMobileData();
  const [pin, setPin] = useState(initial);
  const [history, setHistory] = useState(initial.dispositionHistory || []);
  const [notes, setNotes] = useState(initial.notes || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const caps = hotCapabilities();
  const parked = hotLeadParkNotice(mobile?.field.drafts);
  const mine = !!user && pin.claimedBy === user.id;
  const canRelease = !!user && caps.claim && (mine || user.role === "manager" || user.role === "admin");
  const canClaim = !!user && caps.claim && !pin.claimedBy;

  useEffect(() => { setPin(initial); setNotes(initial.notes || ""); }, [initial]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { fetchHotLeadDetail } = await import("./fetch");
      const { auth } = await import("@/app/utils/firebase");
      const { apiFetch } = await import("@/app/utils/apiFetch");
      const token = await auth?.currentUser?.getIdToken().catch(() => "");
      if (!alive || !user || !token) return;
      const result = await fetchHotLeadDetail({
        user,
        id: initial.id,
        token,
        fetcher: (url, init) => apiFetch(url, { headers: init.headers }),
      });
      if (!alive || !result.hotLead) return;
      setPin(result.hotLead);
      setHistory(result.hotLead.dispositionHistory || []);
    })();
    return () => { alive = false; };
  }, [initial.id, user]);

  async function enqueue(draft: ReturnType<typeof queueHotClaim>) {
    if (!draft || !mobile?.field.enqueue || !user) return;
    setBusy(true);
    setMessage("");
    try {
      await mobile.field.enqueue(draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : HOT_LEAD_OLD_SERVER_NOTICE);
    } finally {
      setBusy(false);
    }
  }

  async function knock(status: string, disposition: string) {
    if (!user || !caps.dispo) return;
    const tappedAt = new Date();
    const draft = await captureHotKnock({
      user,
      pin,
      draftId: crypto.randomUUID(),
      tappedAt,
      status,
      disposition,
      readGps: async () => {
        const position = await getLocation({ enableHighAccuracy: true, timeout: 10000 });
        return {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        };
      },
    });
    await enqueue(draft);
    const next = hotLeadAfterDispo(pin, status, disposition);
    setPin(next);
    noteHotDispo(pin.id, status, disposition);
  }

  const noCall = !hotLeadCallAllowed(pin);
  const body = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-block rounded-full bg-[#FFF1E6] px-2 py-1 text-xs font-semibold text-[#E8590C]">Hot lead</span>
        {variant === "panel" && onClose ? (
          <button type="button" aria-label="Close hot lead" onClick={onClose} className="px-2 py-1 text-sm text-[#718096]">Close</button>
        ) : null}
      </div>
      <div>
        <p className="text-base font-semibold text-[#2D3748]">{pin.address}</p>
        <p className="text-sm text-[#718096]">{[pin.city, pin.state, pin.zip].filter(Boolean).join(", ")}</p>
      </div>
      {noCall ? <p role="alert" className="text-sm font-semibold text-[#C53030]">{DO_NOT_CALL_WARNING}</p> : null}
      <ul className="space-y-1 text-sm">
        {pin.contacts.map((contact, index) => (
          <li key={`${contact.phone || contact.email || index}`}>
            {contact.name ? <span className="font-semibold text-[#2D3748]">{contact.name} </span> : null}
            {contact.phone && !noCall ? <a href={`tel:${contact.phone}`}>Call {contact.phone}</a> : null}
            {contact.phone && noCall ? <span>{contact.phone}</span> : null}
            {contact.phone && contact.email ? " · " : null}
            {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          </li>
        ))}
      </ul>
      <p className="text-sm text-[#718096]">
        {pin.ghlStage ? `Stage ${pin.ghlStage}` : "Stage not recorded"}
        {pin.ghlSource ? ` · Source ${pin.ghlSource}` : ""}
      </p>
      <p className="text-sm text-[#2D3748]">
        {pin.claimedBy ? (mine ? "Claimed by you" : ownedCopy(pin)) : "Unclaimed"}
      </p>
      {parked ? <p role="status" className="text-sm font-semibold text-[#C53030]">{parked}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-[#C53030]">{message}</p> : null}
      {caps.claim ? (
        <div className="flex gap-2">
          {canClaim ? <button type="button" disabled={busy} onClick={() => void enqueue(queueHotClaim({ user: user!, pin, draftId: crypto.randomUUID(), tappedAt: new Date(), action: "claim" }))}>Claim</button> : null}
          {canRelease ? <button type="button" disabled={busy} onClick={() => void enqueue(queueHotClaim({ user: user!, pin, draftId: crypto.randomUUID(), tappedAt: new Date(), action: "release" }))}>Release</button> : null}
        </div>
      ) : null}
      {caps.dispo ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Hot lead dispositions">
          {KNOCKS.map((row) => (
            <button key={row.id} type="button" disabled={busy} onClick={() => void knock(row.id, row.name)}>{row.name}</button>
          ))}
        </div>
      ) : null}
      <label className="block text-sm">
        Notes
        <textarea aria-label="Hot lead notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-3 py-2" />
      </label>
      <button
        type="button"
        disabled={busy || !caps.dispo}
        onClick={() => void enqueue(queueHotNotes({
          user: user!,
          pin,
          draftId: crypto.randomUUID(),
          tappedAt: new Date(),
          notes,
          baseNotes: pin.notes || "",
          clearNotes: notes === "" && (pin.notes || "") !== "",
        }))}
      >
        Save hot lead notes
      </button>
      {history.length ? (
        <ol className="space-y-1 text-sm text-[#718096]">
          {history.map((entry, index) => (
            <li key={`${entry.timestamp || index}`}>{entry.disposition || "Note"}{entry.userName ? ` · ${entry.userName}` : ""}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );

  if (variant === "section") return <section aria-label="Hot lead">{body}</section>;
  return (
    <div className="rm-lead-detail fixed inset-0 md:inset-y-0 md:right-0 md:left-auto z-[80] w-full md:max-w-sm overflow-y-auto bg-white p-4 shadow-2xl">
      {body}
    </div>
  );
}
