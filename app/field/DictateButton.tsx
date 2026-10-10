"use client";
import { useState, useRef, useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Mic } from "lucide-react";
const speech = registerPlugin<{ dictate(): Promise<{ text: string }> }>(
  "RaydarDictation",
);
export default function DictateButton({
  onText,
  onKeyboard,
}: {
  onText: (text: string) => void;
  onKeyboard: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function dictate() {
    if (Capacitor.getPlatform() !== "android") {
      onKeyboard();
      setMessage(
        "Tap the microphone on your keyboard to dictate. Review your words before saving.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await speech.dictate();
      if (active.current && result.text) {
        onText(result.text);
        setMessage("Added to your draft. Review it, then save.");
      }
    } catch (e) {
      if (active.current) setMessage((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="rf-dictate">
      <button
        type="button"
        className="rf-button"
        disabled={busy}
        onClick={dictate}
      >
        <Mic size={16} />
        {busy ? "Dictating…" : "Dictate notes"}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
