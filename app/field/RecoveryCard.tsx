"use client";
import Image from "next/image";
import { useState } from "react";
import { QrCode } from "lucide-react";
import type { Lead } from "@/app/types";
import { fieldRequest } from "./useFieldData";
export default function RecoveryCard({ lead }: { lead: Lead }) {
  const [url, setUrl] = useState(""),
    [qr, setQr] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const result = await fieldRequest("/api/field-recovery", {
        action: "issue",
        leadId: lead.id,
      });
      const { toDataURL } = await import("qrcode");
      setQr(
        await toDataURL(result.url, {
          width: 400,
          margin: 4,
          errorCorrectionLevel: "M",
        }),
      );
      setUrl(result.url);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rf-recovery">
      <button className="rf-button" disabled={busy} onClick={generate}>
        <QrCode size={17} />
        {busy ? "Creating card…" : "Create callback card"}
      </button>
      {qr && (
        <>
          <Image
            unoptimized
            src={qr}
            alt="QR code to request a scheduling-manager callback"
            width={240}
            height={240}
          />
          <p>Scan to request a call from Happy Solar. Valid for 30 days.</p>
          <input
            aria-label="Callback card link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="rf-button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setMessage("Link copied.");
              } catch {
                setMessage("Select the link above to copy it.");
              }
            }}
          >
            Copy link
          </button>
          <a
            className="rf-button"
            href={qr}
            download={`raydar-callback-${lead.id}.png`}
          >
            Save QR for printing
          </a>
          <p className="rf-caption">
            A callback request is not a booked appointment. Share only with the
            homeowner or on their door card.
          </p>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
