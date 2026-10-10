"use client";
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
const query = "(max-width: 900px)";
const subscribe = (fn: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", fn);
  return () => media.removeEventListener("change", fn);
};
const snapshot = () => window.matchMedia(query).matches;

/** Handle owns the gesture, so scrolling form fields never drags the sheet. */
export default function TerritorySheet({
  collapsed,
  onCollapse,
  title,
  children,
}: {
  collapsed: boolean;
  onCollapse: (value: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const compact = useSyncExternalStore(subscribe, snapshot, () => false);
  const hidden = compact && collapsed;
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; y: number; delta: number } | null>(null);
  const swiped = useRef(false);
  function reset() {
    gesture.current = null;
    panel.current?.classList.remove("is-dragging");
    panel.current?.style.removeProperty("--rt-sheet-drag");
  }
  return (
    <section
      ref={panel}
      className={`rt-panel rt-sheet${hidden ? " is-collapsed" : ""}`}
      aria-label="Territory controls"
    >
      <button
        className="rt-sheet-handle"
        aria-expanded={!hidden}
        aria-controls="rt-sheet-content"
        aria-label={
          hidden ? "Show territory details" : "Hide territory details"
        }
        onPointerDown={(e) => {
          if (!e.isPrimary || e.button !== 0) return;
          swiped.current = false;
          panel.current?.classList.add("is-dragging");
          gesture.current = { id: e.pointerId, y: e.clientY, delta: 0 };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          g.delta = e.clientY - g.y;
          const limit = Math.max(0, (panel.current?.offsetHeight || 52) - 52);
          const delta = hidden
            ? Math.max(-limit, Math.min(0, g.delta))
            : Math.min(limit, Math.max(0, g.delta));
          panel.current?.style.setProperty("--rt-sheet-drag", `${delta}px`);
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          if (!g || g.id !== e.pointerId) return;
          if (Math.abs(g.delta) > 35) {
            swiped.current = true;
            onCollapse(g.delta > 0);
          }
          reset();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={reset}
        onClick={(e) => {
          if (swiped.current && e.detail !== 0) {
            swiped.current = false;
            return;
          }
          swiped.current = false;
          onCollapse(!hidden);
        }}
      >
        <span className="rt-sheet-grip" aria-hidden="true" />
        <span>{title}</span>
        {hidden ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      <div
        id="rt-sheet-content"
        className="rt-sheet-content"
        inert={hidden}
        aria-hidden={hidden || undefined}
      >
        {children}
      </div>
    </section>
  );
}
