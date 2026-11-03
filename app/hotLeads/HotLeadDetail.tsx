"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_DISPOSITIONS, type Disposition } from "@/app/types/disposition";
import type { User } from "@/app/types";
import { getDispositionsAsync } from "@/app/utils/dispositions";
import { useOptionalMobileData } from "@/app/mobile/_components/MobileDataProvider";
import { rememberHotLeadHistory } from "@/app/mobile/_lib/knockSources";
import { hotLeadDetailState } from "./detailState";
import { DO_NOT_CALL_WARNING, hotCapabilities, hotLeadAfterDispo, hotLeadCallAllowed, noteHotDispo, noteHotLocal, rememberServerHotPin, rememberServerHotPinIfAbsent, subscribeHotLeadDetail, type HotLeadPin } from "./model";
import { stageHotKnock } from "./gps";
import {
  HOT_LEAD_OLD_SERVER_NOTICE,
  HOT_LEAD_OWNED_MESSAGE,
  hotLeadParkNotice,
  hotTerritoryParkNotice,
  queueHotClaim,
  queueHotKnock,
  queueHotNotes,
} from "./save";

function knockChoices(rows: Disposition[]): Disposition[] {
  return rows.filter((row) => row.countsAsDoorKnock && row.id !== "claimed" && row.id !== "unclaimed");
}

function ownedCopy(pin: HotLeadPin): string | null {
  if (!pin.claimedBy) return null;
  return pin.claimedByName ? `${HOT_LEAD_OWNED_MESSAGE} (${pin.claimedByName})` : HOT_LEAD_OWNED_MESSAGE;
}

export function HotLeadDetail({
  pin: initial,
  user,
  variant = "panel",
  dispositions,
  onClose,
}: {
  pin: HotLeadPin;
  user: User | null;
  variant?: "panel" | "section";
  dispositions?: Disposition[];
  onClose?: () => void;
}) {
  const mobile = useOptionalMobileData();
  const canWrite = !!user && !!mobile?.field.enqueue;
  const [pin, setPin] = useState(initial);
  const [history, setHistory] = useState(initial.dispositionHistory || []);
  const [notes, setNotes] = useState(initial.notes || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedDispositions, setLoadedDispositions] = useState<Disposition[]>([]);
  const lock = useRef(false);
  const caps = hotCapabilities();
  const parked = hotLeadParkNotice(mobile?.field.drafts);
  const mine = !!user && pin.claimedBy === user.id;
  const knocks = knockChoices(dispositions ?? loadedDispositions);
  const access = hotLeadDetailState({
    pin,
    canWrite,
    caps,
    userId: user?.id,
    role: user?.role,
  });
  const territoryNotice = access.message || hotTerritoryParkNotice(mobile?.field.drafts, pin.id);
  const noCall = !hotLeadCallAllowed(pin);

  useEffect(() => { setPin(initial); setNotes(initial.notes || ""); }, [initial]);
  useEffect(() => { rememberServerHotPinIfAbsent(initial); }, [initial]);
  useEffect(() => subscribeHotLeadDetail(initial.id, (next) => {
    setPin(next);
    setNotes(next.notes || "");
    setHistory(next.dispositionHistory || []);
  }), [initial.id]);
  useEffect(() => {
    if (dispositions) return;
    let alive = true;
    void getDispositionsAsync().then((items) => {
      if (alive) setLoadedDispositions(items.length ? items : DEFAULT_DISPOSITIONS);
    }).catch(() => {
      if (alive) setLoadedDispositions(DEFAULT_DISPOSITIONS);
    });
    return () => { alive = false; };
  }, [dispositions]);
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
      rememberServerHotPin(result.hotLead);
      setPin(result.hotLead);
      setHistory(result.hotLead.dispositionHistory || []);
      rememberHotLeadHistory(result.hotLead);
    })();
    return () => { alive = false; };
  }, [initial.id, user]);

  async function enqueue(draft: ReturnType<typeof queueHotClaim>): Promise<boolean> {
    if (!draft || !mobile?.field.enqueue || !user) return false;
    await mobile.field.enqueue(draft);
    return true;
  }

  async function runSave(makeDraft: () => ReturnType<typeof queueHotClaim>, after?: () => void) {
    if (lock.current || !canWrite || !user || access.viewOnly) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const saved = await enqueue(makeDraft());
      if (saved) after?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : HOT_LEAD_OLD_SERVER_NOTICE);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function knock(status: string, disposition: string) {
    if (!caps.dispo || access.viewOnly) return;
    const tappedAt = new Date();
    void runSave(() => {
      const draft = queueHotKnock({ user: user!, pin, draftId: crypto.randomUUID(), tappedAt, status, disposition });
      return draft ? stageHotKnock(draft, tappedAt.getTime()) : null;
    }, () => {
      setPin(hotLeadAfterDispo(pin, status, disposition, dispositions ?? loadedDispositions));
      noteHotDispo(pin.id, status, disposition);
    });
  }

  const body = (
    <div className="space-y-4" data-hot-view-only={access.viewOnly ? "true" : "false"}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-[#FFF1E6] px-2 py-1 text-xs font-semibold text-[#E8590C]">3PL lead</span>
          {noCall ? (
            <span role="status" className="inline-block rounded-full bg-[#FFF5F5] px-2 py-1 text-xs font-semibold text-[#C53030]">{DO_NOT_CALL_WARNING}</span>
          ) : null}
        </span>
        {variant === "panel" && onClose ? (
          <button type="button" aria-label="Close 3PL lead" onClick={onClose} className="px-2 py-1 text-sm text-[#718096]">Close</button>
        ) : null}
      </div>
      <div>
        <p className="text-base font-semibold text-[#2D3748]">{pin.address}</p>
        <p className="text-sm text-[#718096]">{[pin.city, pin.state, pin.zip].filter(Boolean).join(", ")}</p>
      </div>
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
      {territoryNotice ? <p role="status" className="text-sm font-semibold text-[#C53030]">{territoryNotice}</p> : null}
      {message ? <p role="status" className="text-sm font-semibold text-[#C53030]">{message}</p> : null}
      {access.showClaim || access.showRelease ? (
        <div className="flex gap-2">
          {access.showClaim ? <button type="button" disabled={busy} onClick={() => void runSave(() => queueHotClaim({ user: user!, pin, draftId: crypto.randomUUID(), tappedAt: new Date(), action: "claim" }), () => {
            const claimedAt = new Date().toISOString();
            setPin({ ...pin, claimedBy: user!.id, claimedByName: user!.name, claimedAt });
            noteHotLocal(pin.id, { claimedBy: user!.id, claimedByName: user!.name, claimedAt });
          })}>Claim</button> : null}
          {access.showRelease ? <button type="button" disabled={busy} onClick={() => void runSave(() => queueHotClaim({ user: user!, pin, draftId: crypto.randomUUID(), tappedAt: new Date(), action: "release" }), () => {
            setPin({ ...pin, claimedBy: null, claimedByName: null, claimedAt: null });
            noteHotLocal(pin.id, { claimedBy: null, claimedByName: null, claimedAt: null });
          })}>Release</button> : null}
        </div>
      ) : null}
      {access.showKnocks ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="3PL lead dispositions">
          {knocks.map((row) => (
            <button key={row.id} type="button" disabled={busy} onClick={() => knock(row.id, row.name)}>{row.name}</button>
          ))}
        </div>
      ) : null}
      <label className="block text-sm">
        Notes
        <textarea aria-label="3PL lead notes" value={notes} readOnly={access.notesReadOnly} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-[#E2E8F0] px-3 py-2" />
      </label>
      {access.showSave ? <button
        type="button"
        disabled={busy || !caps.dispo}
        onClick={() => void runSave(() => queueHotNotes({
          user: user!,
          pin,
          draftId: crypto.randomUUID(),
          tappedAt: new Date(),
          notes,
          baseNotes: pin.notes || "",
          clearNotes: notes === "" && (pin.notes || "") !== "",
        }), () => { noteHotLocal(pin.id, { notes }); })}
      >
        Save 3PL lead notes
      </button> : null}
      {history.length ? (
        <ol className="space-y-1 text-sm text-[#718096]">
          {history.map((entry, index) => (
            <li key={`${entry.timestamp || index}`}>{entry.disposition || "Note"}{entry.userName ? ` · ${entry.userName}` : ""}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );

  if (variant === "section") return <section aria-label="3PL lead">{body}</section>;
  return (
    <div className="rm-lead-detail fixed inset-0 md:inset-y-0 md:right-0 md:left-auto z-[80] w-full md:max-w-sm overflow-y-auto bg-white p-4 shadow-2xl">
      {body}
    </div>
  );
}
