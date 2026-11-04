"use client";

import { HOT_RING_COLOR, HOT_VIEW_ONLY_RING } from "@/app/utils/fieldPin";
import { HOT_VIEW_ONLY_LEGEND } from "./copy";
import { HOT_LEAD_LEGEND, type HotPinFilter } from "./filter";

const OPTIONS: { id: HotPinFilter; label: string }[] = [
  { id: "all", label: "All pins" },
  { id: "only", label: "3PL only" },
  { id: "hide", label: "Hide 3PL" },
];

/** All pins, 3PL only, Hide 3PL. Callers hide this when the flag or role denies the layer. */
export function HotLeadFilterSection({
  value,
  onChange,
}: {
  value: HotPinFilter;
  onChange: (next: HotPinFilter) => void;
}) {
  return (
    <fieldset className="rm-map-filter-group">
      <legend>3PL leads</legend>
      <div className="rm-filter-options" role="group" aria-label="3PL leads">
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, boxShadow: `0 0 0 3px ${HOT_RING_COLOR}` }} />
          <span>🔥</span>
        </span>
        <span>{HOT_LEAD_LEGEND}</span>
        <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 99, boxShadow: `0 0 0 3px ${HOT_VIEW_ONLY_RING}`, outline: `2px dashed ${HOT_VIEW_ONLY_RING}` }} />
        </span>
        <span>{HOT_VIEW_ONLY_LEGEND}</span>
        {OPTIONS.map((option) => (
          <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
