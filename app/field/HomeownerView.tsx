"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { X, Sun, ArrowRight } from "lucide-react";
import type { Lead } from "@/app/types";
import type { FieldConfig, FieldFlags } from "./types";
import { savingsPreview } from "./analysis";
const ProofMap = dynamic(() => import("./ProofMap"), { ssr: false });
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export default function HomeownerView({
  lead,
  config,
  flags,
  onClose,
  onShown,
  onHandoff,
}: {
  lead: Lead;
  config: FieldConfig;
  flags: FieldFlags;
  onClose: () => void;
  onShown: (kind: "preview" | "proof") => void;
  onHandoff: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "proof">(
    flags.preview ? "preview" : "proof",
  );
  const preview = flags.preview ? savingsPreview(lead, config.savings) : null;
  const proof = useMemo(
    () =>
      config.proof.filter(
        (p) =>
          p.approved &&
          p.permission &&
          p.state.toLowerCase() === lead.state.toLowerCase() &&
          p.city.toLowerCase() === lead.city.toLowerCase(),
      ),
    [config.proof, lead.city, lead.state],
  );
  const [marked, setMarked] = useState({ preview: false, proof: false });
  const valid = tab === "preview" ? !!preview : proof.length > 0;
  return (
    <div
      className="rf-present"
      role="dialog"
      aria-modal="true"
      aria-label="Solar conversation preview"
    >
      <header>
        <span className="rf-brand">
          <Sun size={24} /> Raydar <small>by Happy Solar</small>
        </span>
        <button
          className="rf-icon"
          aria-label="Close preview"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      <main>
        <span className="rf-kicker">A FIRST LOOK AT SOLAR</span>
        <h1>
          A brighter possibility
          <br />
          for your home.
        </h1>
        <p>
          {lead.address} · {lead.city}
        </p>
        <div className="rf-tabs">
          {flags.preview && (
            <button
              aria-pressed={tab === "preview"}
              onClick={() => setTab("preview")}
            >
              Your home
            </button>
          )}
          {flags.proof && (
            <button
              aria-pressed={tab === "proof"}
              onClick={() => setTab("proof")}
            >
              Local stories
            </button>
          )}
        </div>
        {tab === "preview" ? (
          preview ? (
            <>
              <div className="rf-preview-number">
                <small>Illustrative average monthly savings</small>
                <strong>
                  {money(preview.savings[0])}–{money(preview.savings[1])}
                </strong>
                <span>After the assumed solar payment</span>
              </div>
              <div className="rf-metrics">
                <div>
                  <small>Current bill entered</small>
                  <b>{money(preview.bill)}/mo</b>
                </div>
                <div>
                  <small>Assumed solar payment</small>
                  <b>
                    {money(preview.payments[0])}–{money(preview.payments[1])}/mo
                  </b>
                </div>
              </div>
              {typeof lead.lat === "number" &&
                typeof lead.lng === "number" &&
                navigator.onLine && (
                  <ProofMap
                    lat={lead.lat}
                    lng={lead.lng}
                    proof={[]}
                    satellite
                  />
                )}
              <p className="rf-caption">
                Based on recorded roof capacity of {lead.solarMaxPanels} panels
                ({preview.kw.toFixed(1)} kW) and{" "}
                {Math.round(preview.production[0])}–
                {Math.round(preview.production[1])} kWh per average month.
                Imagery does not verify roof condition or usable area.
              </p>
              <details>
                <summary>Assumptions and limits</summary>
                <p>
                  This is an illustration, not a quote or financing offer.
                  Actual roof design, usage, utility rules, financing, season
                  and shade change the result. Negative savings mean a higher
                  combined cost. Fixed utility charges remain; export credits
                  are capped at the variable bill. No incentives, escalation or
                  guaranteed savings are included.
                </p>
                <p>
                  Company assumptions: {preview.source}. Reviewed{" "}
                  {new Date(preview.approvedAt).toLocaleDateString()}.
                </p>
              </details>
            </>
          ) : (
            <div className="rf-empty">
              <Sun />
              <h2>Let’s get a proper design.</h2>
              <p>
                A preview needs a bill estimate, recorded roof capacity, and
                current company-approved assumptions for {lead.state}. Your
                consultant can verify the details.
              </p>
            </div>
          )
        ) : (
          <>
            {proof.length > 0 ? (
              <>
                <h2>
                  {proof.length} approved{" "}
                  {proof.length === 1 ? "story" : "stories"} in {lead.city}
                </h2>
                {typeof lead.lat === "number" &&
                  typeof lead.lng === "number" &&
                  navigator.onLine && (
                    <ProofMap lat={lead.lat} lng={lead.lng} proof={proof} />
                  )}
                {proof.map((p) => (
                  <article className="rf-card" key={p.id}>
                    <h3>{p.title}</h3>
                    <p>{p.quote}</p>
                    <small>
                      Verified {new Date(p.verifiedAt).toLocaleDateString()}
                    </small>
                    {p.sourceUrl && (
                      <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                        View source
                      </a>
                    )}
                  </article>
                ))}
              </>
            ) : (
              <div className="rf-empty">
                <h2>Local stories are being prepared.</h2>
                <p>Only verified examples approved for sharing appear here.</p>
              </div>
            )}
          </>
        )}
        {valid && (
          <button
            className="rf-button"
            aria-pressed={marked[tab]}
            onClick={() => {
              onShown(tab);
              setMarked((s) => ({ ...s, [tab]: true }));
            }}
          >
            {marked[tab]
              ? "Marked as shown for this visit"
              : "Mark as shown to homeowner"}
          </button>
        )}
        <button className="rf-primary" onClick={onHandoff}>
          Talk with our scheduling manager <ArrowRight size={18} />
        </button>
      </main>
    </div>
  );
}
