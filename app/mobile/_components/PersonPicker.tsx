"use client";
import { useMemo, useState } from "react";
import { Search, X, ChevronDown, Check } from "lucide-react";
import MobileDialog from "./MobileDialog";
export type PersonOption = { id: string; name: string; detail?: string };
export default function PersonPicker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  emptyLabel = "Choose a user",
  allowAll = false,
}: {
  label: string;
  value: string;
  options: PersonOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
  allowAll?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const selected = options.find((x) => x.id === value);
  const matches = useMemo(
    () =>
      options
        .filter((x) =>
          `${x.name} ${x.detail || ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [options, query]
  );
  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="rm-person-trigger"
        disabled={disabled}
        aria-label={`${label}: ${selected?.name || emptyLabel}`}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setPage(0);
          setOpen(true);
        }}
      >
        <span>{selected?.name || emptyLabel}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <MobileDialog title={label} onClose={() => setOpen(false)}>
          <div className="rm-person-picker">
            <div className="rm-panel-heading">
              <h2>{label}</h2>
              <button
                aria-label={`Close ${label}`}
                onClick={() => setOpen(false)}
              >
                <X size={22} />
              </button>
            </div>
            <label className="rm-search">
              <Search size={18} />
              <input
                autoFocus
                aria-label="Search users"
                placeholder="Search names"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="rm-person-results">
              {allowAll && page === 0 && !query && (
                <button onClick={() => choose("")}>
                  {emptyLabel}
                  {!value && <Check size={18} />}
                </button>
              )}
              {matches.slice(page * 25, page * 25 + 25).map((x) => (
                <button
                  key={x.id}
                  onClick={() => choose(x.id)}
                  aria-label={`Select ${x.name}`}
                >
                  <span>
                    <strong>{x.name}</strong>
                    {x.detail && <small>{x.detail}</small>}
                  </span>
                  {value === x.id && <Check size={18} />}
                </button>
              ))}
              {!matches.length && <p>No matching users.</p>}
            </div>
            <div className="rm-directory-paging">
              <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                {matches.length
                  ? `${page * 25 + 1}–${Math.min(
                      matches.length,
                      page * 25 + 25
                    )} of ${matches.length}`
                  : "0 users"}
              </span>
              <button
                disabled={(page + 1) * 25 >= matches.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </MobileDialog>
      )}
    </>
  );
}
