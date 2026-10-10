"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Search, Trash2 } from "lucide-react";
import MobileDialog from "../../_components/MobileDialog";
export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string;
  isActive: boolean;
  deleted: boolean;
  deletionPending: boolean;
  version: string;
};
export type UsersData = { actorId: string; users: ManagedUser[] };
export type UsersRequest = <T = UsersData>(
  body?: Record<string, unknown>
) => Promise<T>;
export default function UsersWorkspace({
  initialData,
  request,
  preview = false,
}: {
  initialData: UsersData;
  request: UsersRequest;
  preview?: boolean;
}) {
  const [data, setData] = useState(initialData),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<ManagedUser | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const lock = useRef(false);
  const matches = useMemo(
    () =>
      data.users
        .filter((u) =>
          `${u.name} ${u.email} ${u.team} ${u.role}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.users, query]
  );
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setData(await request());
      setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh users.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let removed = 0;
      for (let step = 0; step < 30; step++) {
        const result = await request<{ done: boolean; removed: number }>({
          action: "delete",
          userId: selected.id,
          version: selected.version,
        });
        removed += result.removed;
        if (result.done) {
          setData((d) => ({
            ...d,
            users: d.users.filter((u) => u.id !== selected.id),
          }));
          setNotice(
            `${selected.name}’s account and territories were deleted. Pin history is kept.`
          );
          setSelected(null);
          setPage(0);
          return;
        }
        setNotice(
          `${removed} territories removed. Finishing account deletion…`
        );
        setData((d) => ({
          ...d,
          users: d.users.map((u) =>
            u.id === selected.id ? { ...u, deletionPending: true } : u
          ),
        }));
      }
      setError(
        "Deletion is paused after a large batch. Tap Retry deletion to finish."
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Deletion did not finish. Retry to complete it."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="rm-shell">
      <main className="rm-content rm-users-page">
        <Link href="/mobile/workspace" className="rm-back">
          <ArrowLeft size={18} />
          Manage workspace
        </Link>
        <div className="rm-users-heading">
          <div>
            <span className="rm-eyebrow">ADMIN{preview ? " · DEMO" : ""}</span>
            <h1>Manage Users</h1>
            <p>{data.users.length} accounts</p>
          </div>
          <button disabled={busy} aria-label="Refresh users" onClick={refresh}>
            <RefreshCw size={20} />
          </button>
        </div>
        <label className="rm-search">
          <Search size={18} />
          <input
            aria-label="Search accounts"
            placeholder="Name, email or team"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {!selected && error && (
          <p className="rt-alert" role="alert">
            {error}
          </p>
        )}
        {!selected && notice && (
          <p className="rt-success" role="status">
            {notice}
          </p>
        )}
        <div className="rm-user-list">
          {matches.slice(page * 30, page * 30 + 30).map((u) => (
            <div className="rm-user-row" key={u.id}>
              <span>
                <strong>{u.name}</strong>
                <small>{u.email}</small>
                <small>
                  {u.role}
                  {u.team ? ` · ${u.team}` : ""}
                  {u.deletionPending
                    ? " · Deletion pending"
                    : u.deleted
                    ? " · Inactive"
                    : ""}
                </small>
              </span>
              <button
                disabled={busy || u.id === data.actorId}
                aria-label={
                  u.id === data.actorId
                    ? "Your account cannot be deleted"
                    : `Delete ${u.name}`
                }
                onClick={() => {
                  setSelected(u);
                  setError("");
                  setNotice("");
                }}
              >
                <Trash2 size={18} />
                {u.deletionPending ? "Finish" : "Delete"}
              </button>
            </div>
          ))}
        </div>
        {!matches.length && <p>No matching users.</p>}
        <div className="rm-directory-paging">
          <button
            disabled={!page || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>
            {matches.length
              ? `${page * 30 + 1}–${Math.min(
                  matches.length,
                  page * 30 + 30
                )} of ${matches.length}`
              : "0 users"}
          </span>
          <button
            disabled={(page + 1) * 30 >= matches.length || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
        {selected && (
          <MobileDialog
            title="Delete user account"
            onClose={() => {
              if (!busy) setSelected(null);
            }}
          >
            <div className="rt-dialog">
              <h3>Delete {selected.name}?</h3>
              <p>{selected.email}</p>
              <p>
                This deletes their sign-in account and removes all their
                territory boundaries. Door-knocking history, pin statuses, notes
                and appointment outcomes are kept.
              </p>
              <p>Account deletion cannot be undone.</p>
              {notice && <p role="status">{notice}</p>}
              {error && (
                <p className="rt-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="rt-actions">
                <button disabled={busy} onClick={() => setSelected(null)}>
                  Cancel
                </button>
                <button className="rt-primary" disabled={busy} onClick={remove}>
                  {busy
                    ? "Deleting…"
                    : error || selected.deletionPending
                    ? "Retry deletion"
                    : "Delete account & territories"}
                </button>
              </div>
            </div>
          </MobileDialog>
        )}
      </main>
    </div>
  );
}
