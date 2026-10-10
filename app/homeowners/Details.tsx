"use client";
import { useEffect, useRef, useState } from "react";
import { Home, X } from "lucide-react";
import MobileDialog from "@/app/mobile/_components/MobileDialog";
import { occupancyLabel, suspectedRenter, type Homeowner } from "./model";
import type { HomeownerState } from "./loader";
import { homeownerPinArtwork } from "./artwork";
export function HomeownerSection({ homeowner: h }: { homeowner?: Homeowner }) {
  if (!h) return null;
  return (
    <section className="rh-info" aria-label="Homeowner information">
      <div className="rh-info-top">
        <Home size={20} />
        <span>Homeowner record</span>
      </div>
      <h3>{h.ownerName || "Owner name unavailable"}</h3>
      <span className={`rh-occupancy ${suspectedRenter(h) ? "rh-renter" : ""}`}>
        {occupancyLabel(h)}
      </span>
      <p className="rh-note">
        Occupancy is an estimate from property records. Confirm it in
        conversation.
      </p>
      <details>
        <summary>Property details</summary>
        <dl>
          <dt>Address</dt>
          <dd>{h.address}</dd>
          <dt>Town</dt>
          <dd>
            {h.municipality}, {h.state}
          </dd>
          {h.propertyType && (
            <>
              <dt>Property</dt>
              <dd>{h.propertyType}</dd>
            </>
          )}
          {h.marketValue !== undefined && (
            <>
              <dt>Assessor value</dt>
              <dd>
                {h.marketValue.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })}
              </dd>
            </>
          )}
          {(h.mailingCity || h.mailingZip) && (
            <>
              <dt>Mailing city / ZIP</dt>
              <dd>
                {h.mailingCity} {h.mailingZip}
              </dd>
            </>
          )}
        </dl>
      </details>
    </section>
  );
}
export function HomeownerDetail({
  homeowner,
  onClose,
}: {
  homeowner: Homeowner;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="rm-lead-detail rh-detail"
      aria-label="Homeowner details"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="rh-detail-heading">
        <span>Home details</span>
        <button
          data-raydar-back-close
          onClick={onClose}
          aria-label="Close homeowner details"
        >
          <X size={22} />
        </button>
      </div>
      <div className="rh-detail-content">
        <h2>{homeowner.address}</h2>
        <p>
          {homeowner.municipality}, {homeowner.state}
        </p>
        <HomeownerSection homeowner={homeowner} />
        <p className="rh-note">
          No visit is attached to this home in your loaded pins.
        </p>
      </div>
    </dialog>
  );
}
export function HomeownerStatus({
  state,
  onSelect,
}: {
  state: HomeownerState;
  onSelect: (h: Homeowner) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [count, setCount] = useState(25);
  const filtered = open
    ? state.homes.filter((h) =>
        `${h.address} ${h.ownerName} ${h.municipality}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : [];
  const title = state.zoomIn
    ? "Zoom in for homes"
    : state.error
      ? "Homes unavailable"
      : state.offline
        ? "Saved homes"
        : state.partial
          ? "Homes · zoom for more"
          : state.loading
            ? "Loading homes…"
            : `Homes · ${state.homes.length}`;
  return (
    <>
      <button
        className="rh-map-status"
        onClick={() => setOpen(true)}
        aria-label={`${title}. Open homeowner list`}
      >
        <Home size={13} />
        {title}
      </button>
      {open && (
        <MobileDialog
          title="Homes in this map area"
          onClose={() => setOpen(false)}
        >
          <div className="rh-home-list">
            <div className="rh-detail-heading">
              <h2>Homes in this area</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close homeowner list"
              >
                <X size={22} />
              </button>
            </div>
            <p className="rh-note">
              Gray pins show property records. Existing visit pins keep their
              colors and outcomes.
            </p>
            {state.error && <p role="status">{state.error}</p>}
            {state.partial && (
              <p role="status">
                This area is partly loaded. Zoom closer to see more homes.
              </p>
            )}
            {state.zoomIn && <p>Zoom closer to street level to load homes.</p>}
            {state.offline && (
              <p>Showing saved records. Unvisited areas need a connection.</p>
            )}
            <label>
              Find a home
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCount(25);
                }}
                placeholder="Address or owner name"
              />
            </label>
            <p className="rh-note">
              {filtered.length} saved records in this view
            </p>
            {filtered.slice(0, count).map((h) => (
              <button
                className="rh-list-row"
                key={h.id}
                onClick={() => {
                  setOpen(false);
                  onSelect(h);
                }}
              >
                <img
                  src={homeownerPinArtwork(suspectedRenter(h), 18).url}
                  alt=""
                  width={24}
                  height={28}
                />
                <span>
                  <strong>{h.address}</strong>
                  <small>
                    {h.ownerName || "Name unavailable"} · {occupancyLabel(h)}
                  </small>
                </span>
              </button>
            ))}
            {count < filtered.length && (
              <button
                className="rh-more"
                onClick={() => setCount((n) => n + 25)}
              >
                Show 25 more homes
              </button>
            )}
          </div>
        </MobileDialog>
      )}
    </>
  );
}
