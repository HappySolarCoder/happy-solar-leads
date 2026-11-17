"use client";
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronDown, Check } from "lucide-react";
import MobileDialog from "./MobileDialog";
import {
  assigneeDialogHost,
  chooseSearchedPerson,
} from "../_lib/assigneePicker";
export type PersonOption = { id: string; name: string; detail?: string };

function blurActiveField() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

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
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [host, setHost] = useState<HTMLElement | null>(null);
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
  const close = () => {
    blurActiveField();
    setOpen(false);
  };
  const choose = (id: string) => {
    const next = chooseSearchedPerson(id, onChange);
    blurActiveField();
    setQuery(next.query);
    setPage(0);
    setOpen(next.open);
  };
  // A focused search field on a phone dismisses the keyboard on pointerdown
  // and shifts the dialog before click, so the tap misses the name and the X.
  // Run the action here, and keep click for keyboard activation only.
  const tap = (event: PointerEvent<HTMLButtonElement>, action: () => void) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    action();
  };
  const activateFromKeyboard = (
    event: MouseEvent<HTMLButtonElement>,
    action: () => void
  ) => {
    if (event.detail !== 0) return;
    action();
  };
  const dialog =
    open && host ? (
      <MobileDialog title={label} onClose={close}>
        <div className="rm-person-picker">
          <div className="rm-panel-heading">
            <h2>{label}</h2>
            <button
              type="button"
              aria-label={`Close ${label}`}
              onPointerDown={(event) => tap(event, close)}
              onClick={(event) => activateFromKeyboard(event, close)}
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
              <button
                type="button"
                onPointerDown={(event) => tap(event, () => choose(""))}
                onClick={(event) => activateFromKeyboard(event, () => choose(""))}
              >
                {emptyLabel}
                {!value && <Check size={18} />}
              </button>
            )}
            {matches.slice(page * 25, page * 25 + 25).map((x) => (
              <button
                key={x.id}
                type="button"
                onPointerDown={(event) => tap(event, () => choose(x.id))}
                onClick={(event) => activateFromKeyboard(event, () => choose(x.id))}
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
            <button
              type="button"
              disabled={!page}
              onPointerDown={(event) => tap(event, () => setPage((p) => p - 1))}
              onClick={(event) =>
                activateFromKeyboard(event, () => setPage((p) => p - 1))
              }
            >
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
              type="button"
              disabled={(page + 1) * 25 >= matches.length}
              onPointerDown={(event) => tap(event, () => setPage((p) => p + 1))}
              onClick={(event) =>
                activateFromKeyboard(event, () => setPage((p) => p + 1))
              }
            >
              Next
            </button>
          </div>
        </div>
      </MobileDialog>
    ) : null;
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="rm-person-trigger"
        disabled={disabled}
        aria-label={`${label}: ${selected?.name || emptyLabel}`}
        aria-haspopup="dialog"
        onClick={() => {
          setQuery("");
          setPage(0);
          setHost(assigneeDialogHost(anchorRef.current, document.body));
          setOpen(true);
        }}
      >
        <span>{selected?.name || emptyLabel}</span>
        <ChevronDown size={16} />
      </button>
      {dialog && host ? createPortal(dialog, host) : null}
    </>
  );
}
