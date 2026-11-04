"use client";

import { useOptionalMobileData } from "@/app/mobile/_components/MobileDataProvider";
import { territoryRecoveryRows } from "./syncOutbox";

/** Parked 3PL territory saves. Dismiss removes the draft. It is not sent again. */
export function TerritoryRecoveryList({ floating = true }: { floating?: boolean }) {
  const mobile = useOptionalMobileData();
  const rows = territoryRecoveryRows(mobile?.field.drafts || []);
  if (!rows.length) return null;
  const className = floating
    ? "absolute bottom-4 left-4 z-20 max-w-sm space-y-2"
    : "max-w-sm space-y-2";
  return (
    <ul aria-label="Unsaved 3PL leads" className={className}>
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#2D3748] shadow-lg">
          <span>{row.label}</span>
          <button type="button" className="rf-plain" onClick={() => { void mobile?.field.discard(row.id); }}>
            Dismiss
          </button>
        </li>
      ))}
    </ul>
  );
}
