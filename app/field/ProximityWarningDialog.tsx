"use client";

import { useCallback, useRef, useState } from "react";
import {
  PROXIMITY_WARNING_CANCEL,
  PROXIMITY_WARNING_CONFIRM,
  PROXIMITY_WARNING_MESSAGE,
} from "./proximityWarning";

export function ProximityWarningDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="proximity-warning-title" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <p id="proximity-warning-title" className="text-base text-[#2D3748]">{PROXIMITY_WARNING_MESSAGE}</p>
        <button type="button" className="mt-4 min-h-11 w-full rounded-lg bg-[#203D49] font-semibold text-white" onClick={onConfirm}>
          {PROXIMITY_WARNING_CONFIRM}
        </button>
        <button type="button" className="mt-2 min-h-11 w-full rounded-lg border border-[#D5DFDA] text-[#2D3748]" onClick={onCancel}>
          {PROXIMITY_WARNING_CANCEL}
        </button>
      </div>
    </div>
  );
}

/** One dialog. The module guards a second tap while this promise is open. */
export function useProximityPrompt() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<(confirmed: boolean) => void>(() => {});
  const ask = useCallback((message: string) => {
    if (message !== PROXIMITY_WARNING_MESSAGE) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);
  const finish = (confirmed: boolean) => {
    setOpen(false);
    resolver.current(confirmed);
  };
  const dialog = (
    <ProximityWarningDialog open={open} onConfirm={() => finish(true)} onCancel={() => finish(false)} />
  );
  return { ask, dialog };
}
