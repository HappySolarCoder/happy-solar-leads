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
import PlaceSearch, { type Place } from "./PlaceSearch";
import { rectangleCorners, type DrawingTool } from "./drawing";
import PersonPicker from "../_components/PersonPicker";
import TerritorySheet from "./TerritorySheet";
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
const NO_CANDIDATES: TerritoryReview["candidates"] = [];
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
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("rectangle");
  const [territoryPage, setTerritoryPage] = useState(0);
  const [deleteAll, setDeleteAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [boundaryComplete, setBoundaryComplete] = useState(false);
  const [searchPlace, setSearchPlace] = useState<Place | null>(null);
  const pending = useRef<{ key: string; requestId: string } | null>(null),
    lock = useRef(false);
  const selectedArea = data.territories.find((t) => t.id === selected);
  const recipients = useMemo(
    () => data.members.filter(mayReceiveTerritory),
    [data.members]
  );
  const repOptions = useMemo(
    () =>
      recipients.map((m) => ({
        id: m.id,
        name: m.name,
        detail: m.team || m.role,
      })),
    [recipients]
  );
  const userOptions = useMemo(() => {
    const counts = new Map<string, number>();
    data.territories.forEach((t) =>
      counts.set(t.userId, (counts.get(t.userId) || 0) + 1)
    );
    return data.members.map((m) => ({
      id: m.id,
      name: m.name,
      detail: `${counts.get(m.id) || 0} territories · ${
        m.team || m.role || "Team member"
      }`,
    }));
  }, [data.members, data.territories]);
  const mapAreas = useMemo(
    () => data.territories.filter((t) => !repFilter || t.userId === repFilter),
    [data.territories, repFilter]
  );
  const filterUser = data.members.find((m) => m.id === repFilter);
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
      setCollapsed(false);
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
    setCollapsed(true);
    setBoundaryComplete(false);
    setSelected("");
    setDrawingTool("rectangle");
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
    setTerritoryPage(0);
    setCollapsed(false);
    setBoundaryComplete(false);
    setMode("list");
    setPoints([]);
    setReview(null);
    setError("");
    pending.current = null;
  }
  function redraw(tool = drawingTool) {
    setDrawingTool(tool);
    setMode("draw");
    setBoundaryComplete(false);
    setPoints([]);
    setReview(null);
    setError("");
    setCollapsed(true);
    pending.current = null;
  }
  function finishBoundary(next = points) {
    try {
      if (next.length < (drawingTool === "freehand" ? 3 : 4)) return;
      setPoints(validateTerritoryPolygon(next));
      setBoundaryComplete(true);
      setError("");
    } catch (e) {
      setPoints(next);
      setError(
        e instanceof Error ? e.message : "Redraw the boundary and try again."
      );
    }
    setCollapsed(false);
  }
  function addPoint(p: TerritoryPoint) {
    if (boundaryComplete || busy) return;
    if (drawingTool === "rectangle" && points.length === 1) {
      finishBoundary(rectangleCorners(points[0], p));
    } else
      setPoints((prev) =>
        drawingTool === "rectangle"
          ? [p]
          : prev.length < 80
          ? [...prev, p]
          : prev
      );
  }
  async function inspect() {
    await run(async () => {
      if (!boundaryComplete)
        throw new Error("Finish your boundary on the map first.");
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
        ? "Territory deleted. Pin history and assignments are kept."
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
  async function removeAll() {
    await run(async () => {
      const targets = data.territories.filter((t) => t.userId === repFilter);
      let removed = 0;
      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50),
          body = {
            action: "archive-many",
            userId: repFilter,
            territories: chunk.map((t) => ({ id: t.id, version: t.version })),
          };
        const key = JSON.stringify(body);
        if (pending.current?.key !== key)
          pending.current = { key, requestId: crypto.randomUUID() };
        await request({ ...body, requestId: pending.current.requestId });
        const ids = new Set(chunk.map((t) => t.id));
        removed += chunk.length;
        setData((d) => ({
          ...d,
          territories: d.territories.filter((t) => !ids.has(t.id)),
        }));
        setNotice(`${removed} territories deleted. Pin history is kept.`);
        setSelected("");
        setTerritoryPage(0);
      }
      setDeleteAll(false);
      pending.current = null;
    });
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
      <div className={`rt-body${collapsed ? " rt-details-collapsed" : ""}`}>
        <section className="rt-map-section">
          <PlaceSearch
            preview={preview}
            disabled={busy}
            onSelect={(p) => {
              setSearchPlace({ ...p });
              setSelected("");
            }}
          />
          <TerritoryMap
            searchPlace={searchPlace}
            drawingTool={drawingTool}
            onDraw={finishBoundary}
            territories={mapAreas}
            selectedId={selected}
            drawing={mode === "draw" && !busy && !boundaryComplete}
            points={points}
            candidates={review?.candidates || NO_CANDIDATES}
            onPoint={addPoint}
            onSelect={(id) => {
              if (mode === "list") {
                setSelected(id);
                setCollapsed(false);
                setError("");
              }
            }}
          />
          {mode === "draw" && !boundaryComplete && (
            <div className="rt-map-drawing-tools">
              <div
                className="rt-draw-tools"
                role="group"
                aria-label="Boundary tool"
              >
                {(
                  [
                    ["rectangle", "Rectangle"],
                    ["corners", "Corners"],
                    ["freehand", "Draw"],
                  ] as const
                ).map(([tool, label]) => (
                  <button
                    key={tool}
                    aria-pressed={drawingTool === tool}
                    disabled={busy}
                    onClick={() => redraw(tool)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="rt-drawing-actions">
                <button
                  aria-label={
                    drawingTool === "corners" ? "Undo corner" : "Clear area"
                  }
                  disabled={!points.length || busy}
                  onClick={() =>
                    setPoints((p) =>
                      drawingTool === "corners" ? p.slice(0, -1) : []
                    )
                  }
                >
                  <Undo2 size={16} />
                  {drawingTool === "corners" ? "Undo" : "Clear"}
                </button>
                <span aria-live="polite">
                  {drawingTool === "rectangle"
                    ? points.length
                      ? "Tap opposite corner"
                      : "Tap first corner"
                    : drawingTool === "corners"
                    ? `${points.length} corners`
                    : "Trace & lift to finish"}
                </span>
                {drawingTool === "corners" && (
                  <button
                    className="rt-primary"
                    disabled={points.length < 4 || busy}
                    onClick={() => finishBoundary()}
                  >
                    Done <Check size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
        <TerritorySheet
          collapsed={collapsed}
          onCollapse={setCollapsed}
          title={
            mode === "list"
              ? "Team territories"
              : mode === "review"
              ? "Review & assign"
              : boundaryComplete
              ? "Boundary ready · Assign or redraw"
              : "Territory details"
          }
        >
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
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setTerritoryPage(0);
                    }}
                  />
                </label>
                <PersonPicker
                  label="Choose territory user"
                  value={repFilter}
                  options={userOptions}
                  emptyLabel="All team members"
                  allowAll
                  onChange={(id) => {
                    setRepFilter(id);
                    setSelected("");
                    setTerritoryPage(0);
                  }}
                />
              </div>
              {filterUser && (
                <div className="rt-owner-summary">
                  <strong>{filterUser.name}’s territories</strong>
                  <span>{mapAreas.length} areas</span>
                  <button
                    disabled={busy || !mapAreas.length}
                    onClick={() => {
                      setError("");
                      setDeleteAll(true);
                    }}
                  >
                    Delete all territories
                  </button>
                </div>
              )}
              {selectedArea && (
                <div className="rt-selected">
                  <span className="rm-eyebrow">SELECTED AREA</span>
                  <h3>{selectedArea.name}</h3>
                  <p>
                    {selectedArea.userName} ·{" "}
                    {selectedArea.leadCount ?? selectedArea.leadIds.length}{" "}
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
                      Delete territory
                    </button>
                  </div>
                </div>
              )}
              <div className="rt-list">
                {areas.length ? (
                  areas
                    .slice(territoryPage * 30, territoryPage * 30 + 30)
                    .map((t) => (
                      <button
                        className={`rt-area${
                          selected === t.id ? " selected" : ""
                        }`}
                        key={t.id}
                        onClick={() => {
                          setSelected(t.id);
                          setCollapsed(false);
                        }}
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
                            {t.userName} · {t.leadCount ?? t.leadIds.length}{" "}
                            pins at last save
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
              {areas.length > 30 && (
                <div className="rm-directory-paging">
                  <button
                    disabled={!territoryPage}
                    onClick={() => setTerritoryPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    {territoryPage + 1} / {Math.ceil(areas.length / 30)}
                  </span>
                  <button
                    disabled={(territoryPage + 1) * 30 >= areas.length}
                    onClick={() => setTerritoryPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
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
                      ? boundaryComplete
                        ? "2 · TERRITORY DETAILS"
                        : "1 · DRAW YOUR AREA"
                      : "3 · REVIEW & ASSIGN"}
                  </span>
                  <h2>
                    {mode === "draw"
                      ? boundaryComplete
                        ? "Name & assign"
                        : "Mark the neighborhood"
                      : name}
                  </h2>
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
                  <div className="rt-boundary-summary">
                    <p>
                      {boundaryComplete
                        ? `${points.length} corners · Boundary ready`
                        : "Draw your boundary on the full map, then name it and choose a rep."}
                    </p>
                    <button
                      onClick={() =>
                        boundaryComplete ? redraw() : setCollapsed(true)
                      }
                      disabled={busy}
                    >
                      {boundaryComplete ? "Redraw boundary" : "Open full map"}
                    </button>
                  </div>
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
                      <PersonPicker
                        label="Assign to"
                        value={rep}
                        options={repOptions}
                        onChange={(id) => {
                          setRep(id);
                          setReview(null);
                        }}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  {!boundaryComplete && (
                    <p className="rt-help">
                      {drawingTool === "rectangle"
                        ? "Tap two opposite corners to make a rectangle with four corners. Drag the map to move or pinch to zoom."
                        : drawingTool === "freehand"
                        ? "Trace the boundary with one finger or your mouse. Lift to finish. Use Move map to reposition; drawing again replaces the outline."
                        : "Tap at least 4 corners around your area. Drag to move or pinch to zoom."}
                    </p>
                  )}
                  <div className="rt-actions">
                    <button
                      className="rt-primary"
                      onClick={inspect}
                      disabled={
                        !boundaryComplete ||
                        points.length < (drawingTool === "freehand" ? 3 : 4) ||
                        !rep ||
                        !name.trim() ||
                        busy
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
                    <button onClick={() => redraw()} disabled={busy}>
                      Redraw boundary
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
        </TerritorySheet>
      </div>
      {deleteAll && filterUser && (
        <MobileDialog
          title="Delete all territories"
          onClose={() => {
            if (!busy) setDeleteAll(false);
          }}
        >
          <div className="rt-dialog">
            <h3>
              Delete {mapAreas.length} territories for {filterUser.name}?
            </h3>
            <p>
              Removes this user’s territory boundaries. Door-knocking history,
              pin statuses, notes and appointments are kept.
            </p>
            {notice && <p role="status">{notice}</p>}
            {error && (
              <p role="alert">
                {error} Any remaining territories are still listed; retry to
                finish.
              </p>
            )}
            <div className="rt-actions">
              <button disabled={busy} onClick={() => setDeleteAll(false)}>
                Cancel
              </button>
              <button
                className="rt-primary"
                disabled={busy || !mapAreas.length}
                onClick={removeAll}
              >
                {busy ? "Deleting…" : "Delete all territories"}
              </button>
            </div>
          </div>
        </MobileDialog>
      )}
      {dialog && selectedArea && (
        <MobileDialog
          title={
            dialog === "rename"
              ? "Rename territory"
              : dialog === "transfer"
              ? "Transfer this area"
              : "Delete this territory"
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
                  <PersonPicker
                    label="New rep"
                    value={editValue}
                    options={repOptions}
                    onChange={setEditValue}
                    disabled={busy}
                  />
                </label>
                <p>
                  Move this boundary and its still-unworked assigned pins.
                  Claimed pins, appointments, notes, and worked leads stay with
                  their current rep.
                </p>
                {(selectedArea.leadCount ?? selectedArea.leadIds.length) >
                  400 && (
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
                      (selectedArea.leadCount ?? selectedArea.leadIds.length) >
                        400))
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
                  : "Delete territory"}
              </button>
            </div>
          </div>
        </MobileDialog>
      )}
    </div>
  );
}
