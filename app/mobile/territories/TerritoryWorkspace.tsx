"use client";
import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  MapPinned,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import type { TerritoryPoint } from "@/app/types/territory";
import {
  mayReceiveTerritory,
  validateTerritoryPolygon,
  type ManagedTerritory,
  type TerritoryMember,
  type TerritoryReview,
} from "@/app/utils/territoryManager";
import MobileDialog from "../_components/MobileDialog";
const TerritoryMap = dynamic(() => import("./TerritoryMap"), {
  ssr: false,
  loading: () => (
    <div className="rt-map-wrap rt-loading">Loading your map…</div>
  ),
});
export type TerritoryData = {
  actor: TerritoryMember;
  members: TerritoryMember[];
  territories: ManagedTerritory[];
};
export type TerritoryRequest = <T = TerritoryData>(
  body?: Record<string, unknown>
) => Promise<T>;
export default function TerritoryWorkspace({
  initialData,
  request,
  preview = false,
}: {
  initialData: TerritoryData;
  request: TerritoryRequest;
  preview?: boolean;
}) {
  const [data, setData] = useState(initialData),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState(""),
    [repFilter, setRepFilter] = useState("");
  const [mode, setMode] = useState<"list" | "draw" | "review">("list"),
    [points, setPoints] = useState<TerritoryPoint[]>([]);
  const [name, setName] = useState(""),
    [rep, setRep] = useState(""),
    [review, setReview] = useState<TerritoryReview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<
      "rename" | "transfer" | "archive" | null
    >(null),
    [editValue, setEditValue] = useState("");
  const pending = useRef<{ key: string; requestId: string } | null>(null),
    lock = useRef(false);
  const selectedArea = data.territories.find((t) => t.id === selected);
  const recipients = data.members.filter(mayReceiveTerritory);
  const areas = useMemo(
    () =>
      data.territories
        .filter(
          (t) =>
            (!repFilter || t.userId === repFilter) &&
            `${t.name} ${t.userName}`
              .toLowerCase()
              .includes(filter.toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.territories, filter, repFilter]
  );
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    setData(await request());
  }
  function start() {
    setSelected("");
    setMode("draw");
    setPoints([]);
    setReview(null);
    setName("");
    setRep(repFilter || recipients[0]?.id || "");
    setError("");
    setNotice("");
    pending.current = null;
  }
  function cancel() {
    setMode("list");
    setPoints([]);
    setReview(null);
    setError("");
    pending.current = null;
  }
  async function inspect() {
    await run(async () => {
      const polygon = validateTerritoryPolygon(points);
      if (!name.trim()) throw new Error("Give your territory a short name.");
      if (!rep) throw new Error("Choose the rep who will work this area.");
      setReview(
        await request<TerritoryReview>({
          action: "preview",
          polygon,
          userId: rep,
        })
      );
      setMode("review");
      pending.current = null;
    });
  }
  async function mutate(body: Record<string, unknown>) {
    const key = JSON.stringify(body);
    if (pending.current?.key !== key)
      pending.current = { key, requestId: crypto.randomUUID() };
    const result = await request<{
      id: string;
      changed: number;
      skipped?: number;
    }>({ ...body, requestId: pending.current.requestId });
    // A save may succeed even if the following refresh fails. Report that
    // accurately and retain the operation id for an idempotent retry.
    setNotice(
      body.action === "archive"
        ? "Boundary removed. All pins keep their current assignments."
        : body.action === "rename"
        ? "Territory renamed."
        : `${result.changed} pins assigned. ${
            result.skipped || 0
          } worked or changed pins stayed with their current rep.`
    );
    setDialog(null);
    cancel();
    setSelected(body.action === "archive" ? "" : result.id);
    try {
      await reload();
    } catch {
      setError(
        "Saved successfully, but the list could not refresh. Tap Refresh to see the saved territory."
      );
    }
  }
  function openEdit(kind: "rename" | "transfer" | "archive") {
    setError("");
    setEditValue(
      kind === "rename" ? selectedArea?.name || "" : selectedArea?.userId || ""
    );
    setDialog(kind);
    pending.current = null;
  }
  return (
    <div className="rt-shell">
      <header className="rt-header">
        <Link href="/mobile/more" aria-label="Back to workspace">
          <ArrowLeft size={22} />
        </Link>
        <div>
          <span className="rm-eyebrow">
            TEAM WORKSPACE{preview ? " · DEMO" : ""}
          </span>
          <h1>Territories</h1>
        </div>
        <button
          onClick={() => run(reload)}
          disabled={busy || mode !== "list"}
          aria-label="Refresh territories"
        >
          <RefreshCw size={20} />
        </button>
      </header>
      <div className="rt-body">
        <section className="rt-map-section">
          <TerritoryMap
            territories={data.territories}
            selectedId={selected}
            drawing={mode === "draw" && !busy}
            points={points}
            candidates={review?.candidates || []}
            onPoint={(p) =>
              setPoints((prev) => (prev.length < 80 ? [...prev, p] : prev))
            }
            onSelect={(id) => {
              if (mode === "list") {
                setSelected(id);
                setError("");
              }
            }}
          />
        </section>
        <section className="rt-panel" aria-label="Territory controls">
          {error && (
            <div className="rt-alert" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="rt-success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {mode === "list" ? (
            <>
              <div className="rt-panel-heading">
                <div>
                  <h2>Your team’s areas</h2>
                  <p>
                    {data.territories.length} territories · {recipients.length}{" "}
                    available reps
                  </p>
                </div>
                <button
                  className="rt-primary"
                  onClick={start}
                  disabled={busy || !recipients.length}
                >
                  <Plus size={18} />
                  New area
                </button>
              </div>
              {!data.actor.team && data.actor.role === "manager" && (
                <p className="rt-help">
                  Only your areas are shown. Ask an admin to set your Team in
                  your user profile to manage other reps.
                </p>
              )}
              <div className="rt-filters">
                <label className="rt-search">
                  <Search size={18} />
                  <input
                    aria-label="Search territories"
                    placeholder="Find a territory or rep"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter by rep"
                  value={repFilter}
                  onChange={(e) => setRepFilter(e.target.value)}
                >
                  <option value="">All reps</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              {selectedArea && (
                <div className="rt-selected">
                  <span className="rm-eyebrow">SELECTED AREA</span>
                  <h3>{selectedArea.name}</h3>
                  <p>
                    {selectedArea.userName} · {selectedArea.leadIds.length}{" "}
                    assigned pins at last save
                  </p>
                  <div className="rt-row-actions">
                    <button onClick={() => openEdit("rename")} disabled={busy}>
                      <Pencil size={15} />
                      Rename
                    </button>
                    <button
                      onClick={() => openEdit("transfer")}
                      disabled={busy}
                    >
                      <ArrowRight size={15} />
                      Transfer
                    </button>
                    <button onClick={() => openEdit("archive")} disabled={busy}>
                      Remove boundary
                    </button>
                  </div>
                </div>
              )}
              <div className="rt-list">
                {areas.length ? (
                  areas.map((t) => (
                    <button
                      className={`rt-area${
                        selected === t.id ? " selected" : ""
                      }`}
                      key={t.id}
                      onClick={() => setSelected(t.id)}
                      aria-pressed={selected === t.id}
                    >
                      <span
                        className="rt-area-icon"
                        style={{ color: t.userColor }}
                      >
                        <MapPinned size={22} />
                      </span>
                      <span>
                        <strong>{t.name}</strong>
                        <small>
                          {t.userName} · {t.leadIds.length} pins at last save
                        </small>
                      </span>
                      <ArrowRight size={18} />
                    </button>
                  ))
                ) : (
                  <div className="rt-empty">
                    <MapPinned size={30} />
                    <h3>
                      {data.territories.length
                        ? "No matching areas"
                        : "Give every rep a clear area"}
                    </h3>
                    <p>
                      {data.territories.length
                        ? "Try a different name or rep."
                        : "Tap New area, mark the corners, and review available pins before assigning."}
                    </p>
                  </div>
                )}
              </div>
              <p className="rt-help">
                Select an area to see it on the map. Your live pin outcomes stay
                intact.
              </p>
            </>
          ) : (
            <>
              <div className="rt-panel-heading">
                <div>
                  <span className="rm-eyebrow">
                    {mode === "draw"
                      ? "1 · DRAW YOUR AREA"
                      : "2 · REVIEW & ASSIGN"}
                  </span>
                  <h2>{mode === "draw" ? "Mark the neighborhood" : name}</h2>
                </div>
                <button
                  onClick={cancel}
                  aria-label="Cancel new territory"
                  disabled={busy}
                >
                  <X size={20} />
                </button>
              </div>
              {mode === "draw" ? (
                <>
                  <div className="rt-form">
                    <label>
                      Territory name
                      <input
                        maxLength={60}
                        placeholder="e.g. Maple Street East"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Assign to
                      <select
                        value={rep}
                        onChange={(e) => {
                          setRep(e.target.value);
                          setReview(null);
                        }}
                        disabled={busy}
                      >
                        <option value="">Choose a rep</option>
                        {recipients.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="rt-help">
                    Tap at least 3 corners on the map. You can still drag and
                    zoom. Keep areas small enough for a useful knocking session.
                  </p>
                  <div className="rt-actions">
                    <button
                      onClick={() => setPoints((p) => p.slice(0, -1))}
                      disabled={!points.length || busy}
                    >
                      <Undo2 size={18} />
                      Undo corner
                    </button>
                    <button
                      className="rt-primary"
                      onClick={inspect}
                      disabled={
                        points.length < 3 || !rep || !name.trim() || busy
                      }
                    >
                      {busy ? "Checking…" : "Review pins"}
                      <ArrowRight size={18} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="rt-review-owner">
                    For{" "}
                    <strong>
                      {recipients.find((m) => m.id === rep)?.name}
                    </strong>
                  </p>
                  <div className="rt-counts">
                    <div>
                      <strong>{review?.eligible || 0}</strong>
                      <span>available pins</span>
                    </div>
                    <div>
                      <strong>{review?.skipped || 0}</strong>
                      <span>left unchanged</span>
                    </div>
                  </div>
                  <p className="rt-help">
                    Yellow dots are available. Claimed, worked, customer, and
                    other reps’ pins keep their owners and outcomes. This saves
                    the boundary and assigns only the reviewed available pins.
                  </p>
                  {review?.truncated && (
                    <p className="rt-alert" role="alert">
                      This area is too large to check completely. Draw a smaller
                      area; nothing has been assigned. Limit: 400 available pins
                      per territory.
                    </p>
                  )}
                  <div className="rt-actions">
                    <button
                      onClick={() => {
                        setMode("draw");
                        setReview(null);
                        setError("");
                      }}
                      disabled={busy}
                    >
                      Edit boundary
                    </button>
                    <button
                      className="rt-primary"
                      disabled={busy || !review || review.truncated}
                      onClick={() =>
                        run(() =>
                          mutate({
                            action: "create",
                            name: name.trim(),
                            userId: rep,
                            polygon: points,
                            candidates: review!.candidates
                              .filter((c) => c.eligible)
                              .map((c) => ({ id: c.id, version: c.version })),
                          })
                        )
                      }
                    >
                      {busy
                        ? "Saving…"
                        : review?.eligible
                        ? `Assign ${review.eligible} pins`
                        : "Save empty area"}
                      <Check size={18} />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
      {dialog && selectedArea && (
        <MobileDialog
          title={
            dialog === "rename"
              ? "Rename territory"
              : dialog === "transfer"
              ? "Transfer this area"
              : "Remove this boundary"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <div className="rt-dialog">
            <h3>{selectedArea.name}</h3>
            {dialog === "rename" ? (
              <label>
                Territory name
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  maxLength={60}
                  disabled={busy}
                />
              </label>
            ) : dialog === "transfer" ? (
              <>
                <label>
                  New rep
                  <select
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    disabled={busy}
                  >
                    {recipients.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Move this boundary and its still-unworked assigned pins.
                  Claimed pins, appointments, notes, and worked leads stay with
                  their current rep.
                </p>
                {selectedArea.leadIds.length > 400 && (
                  <p className="rt-alert">
                    This legacy area exceeds 400 pins. It cannot be transferred
                    here; remove its boundary and create smaller areas without
                    changing existing pin owners.
                  </p>
                )}
              </>
            ) : (
              <p>
                Only the boundary is removed. No leads are deleted or
                unassigned. Existing appointments and follow-ups stay with their
                reps.
              </p>
            )}
            {error && (
              <p role="alert" className="rt-alert">
                {error}
              </p>
            )}
            <div className="rt-actions">
              <button onClick={() => setDialog(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="rt-primary"
                disabled={
                  busy ||
                  !editValue.trim() ||
                  (dialog === "transfer" &&
                    (editValue === selectedArea.userId ||
                      selectedArea.leadIds.length > 400))
                }
                onClick={() =>
                  run(() =>
                    mutate({
                      action: dialog,
                      id: selectedArea.id,
                      version: selectedArea.version,
                      ...(dialog === "rename"
                        ? { name: editValue.trim() }
                        : dialog === "transfer"
                        ? { userId: editValue }
                        : {}),
                    })
                  )
                }
              >
                {busy
                  ? "Saving…"
                  : dialog === "rename"
                  ? "Save name"
                  : dialog === "transfer"
                  ? "Transfer area"
                  : "Remove boundary"}
              </button>
            </div>
          </div>
        </MobileDialog>
      )}
    </div>
  );
}
