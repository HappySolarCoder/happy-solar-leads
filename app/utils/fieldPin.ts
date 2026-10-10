import type { Lead } from "../types";
import type { Disposition } from "../types/disposition";
import { getAppointmentOutcome } from "./appointmentOutcome";

const glyphs: Record<string, string> = {
  fresh: '<path d="m5 11 7-6 7 6v8h-5v-5h-4v5H5z"/>',
  interested: '<path d="m13 3-8 11h6l-1 7 9-12h-6z"/>',
  appointment:
    '<rect x="4" y="6" width="16" height="15" rx="3"/><path d="M8 3v6m8-6v6M4 11h16m-11 5 2 2 4-4"/>',
  sale: '<path d="m4 8 4-4h8l4 4-8 13zM4 8h16M8 4l4 17 4-17"/>',
  return: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  away: '<path d="M6 21V4l11-1v18M3 21h18m-8-9h1"/>',
  stop: '<path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5zM8 8l8 8m0-8-8 8"/>',
  no: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8"/>',
  other: '<circle cx="12" cy="12" r="7"/><path d="M12 8v5m0 3h.01"/>',
};
const safeColor = (value: unknown, fallback: string) =>
  typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value)
    ? value
    : fallback;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function fieldPinStyle(lead: Lead, disposition?: Disposition) {
  const status = String(lead.status || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  let kind = "other",
    color = "#55717c",
    label = disposition?.name || lead.disposition || lead.status || "Unworked";
  if (
    !status ||
    [
      "assigned",
      "unassigned",
      "new",
      "not-knocked",
      "unclaimed",
      "claimed",
    ].includes(status)
  ) {
    kind = "fresh";
    color = "#335364";
    label = "Unworked";
  } else if (status === "interested") {
    kind = "interested";
    color = "#087e80";
  } else if (status === "appointment") {
    kind = "appointment";
    color = "#5362d2";
  } else if (
    ["sale", "sold", "customer"].includes(status) ||
    ["sale", "customer"].includes(lead.leadType || "")
  ) {
    kind = "sale";
    color = "#15805b";
  } else if (["go-back", "callback", "follow-up"].includes(status)) {
    kind = "return";
    color = "#ad690f";
  } else if (["not-home", "not-answered"].includes(status)) {
    kind = "away";
    color = "#52738e";
  } else if (["do-not-knock", "do-not-contact", "dnc"].includes(status)) {
    kind = "stop";
    color = "#b44351";
  } else if (status === "not-interested") {
    kind = "no";
    color = "#747983";
  }
  color = safeColor(disposition?.color, color);
  const solar =
    (
      { great: "#4de0ac", good: "#72b9fa", solid: "#ffca73" } as Record<
        string,
        string
      >
    )[lead.solarCategory || ""] || "#91a8b4";
  return { kind, color, label, solar, outcome: getAppointmentOutcome(lead) };
}
// Static vector artwork, no animation/filters/external images. Cache by visual state.
const cache = new Map<string, string>();
/** Uploads historically had no source field; solar-data tags are authoritative. */
export function isSolarWarmLead(lead: Lead): boolean {
  if (lead.historicalTerritoryPin || ['sale', 'customer'].includes(lead.leadType || '')) return false;
  if (lead.tags?.includes('solar-data')) return true;
  if (['manual', 'manually-added'].includes(lead.source || '')) return false;
  return ['poor', 'solid', 'good', 'great'].includes(lead.solarCategory || '') ||
    (typeof lead.solarScore === 'number' && Number.isFinite(lead.solarScore) && lead.solarScore >= 0);
}

export function fieldPinZoomTier(zoom: number): number {
  return zoom < 12 ? 0 : zoom < 14 ? 1 : zoom < 16 ? 2 : zoom < 18 ? 3 : 4;
}

// Signal R is inline vector geometry: no per-pin asset requests or bitmap decoding.
const signalR = '<g fill="white"><path d="M0 78Q0 64 24 64H48V234H0Z"/><path d="M103 195Q125 192 139 177L173 211Q186 223 189 234H140Z"/></g><g fill="#F0BC18"><path d="M84 0A126 126 0 0 1 193.12 189L155.01 167A82 82 0 0 0 84 44Z"/><path d="M84 54A72 72 0 0 1 146.35 162L115.18 144A36 36 0 0 0 84 90H80Q64 90 64 72Q64 54 80 54Z"/><circle cx="84" cy="126" r="20"/></g>';
export function fieldPinArtwork(
  lead: Lead,
  disposition: Disposition | undefined,
  zoom: number,
  selected = false,
) {
  const style = fieldPinStyle(lead, disposition);
  const tier = fieldPinZoomTier(zoom);
  const size = [14, 20, 34, 36, 30][tier];
  const warm = isSolarWarmLead(lead);
  const key = [
    size,
    style.kind,
    style.color,
    style.solar,
    style.outcome?.key,
    style.outcome?.color,
    selected,
    warm,
  ].join(":");
  let url = cache.get(key);
  if (!url) {
    const small = zoom < 14;
    let svg = small
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56"><circle cx="24" cy="28" r="18" fill="${style.color}" stroke="${style.outcome?.color || style.solar}" stroke-width="5"/><circle cx="24" cy="28" r="7" fill="white"/>${selected ? '<circle cx="24" cy="28" r="23" fill="none" stroke="#0bcbdd" stroke-width="2"/>' : ""}</svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56">${selected ? '<path d="M2 15V3h12m20 0h12v12M2 31v12h9m26 0h9V31" fill="none" stroke="#00d4de" stroke-width="2"/>' : ""}<path d="M24 53 8 35V13l7-7h18l7 7v22z" fill="#173240" stroke="white" stroke-width="2"/><path d="M24 47 12 33V15l5-5h14l5 5v18z" fill="${style.color}"/><path d="M17 11h14" stroke="${style.solar}" stroke-width="3" stroke-linecap="round"/><g transform="translate(12 16)" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyphs[style.kind]}</g>${style.outcome ? `<rect x="29" y="0" width="19" height="18" rx="6" fill="${style.outcome.color}" stroke="white" stroke-width="1.5"/><text x="38.5" y="13" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="12">${escape(style.outcome.symbol)}</text>` : ""}</svg>`;
    if (warm && !small) {
      // Keep the main disposition glyph and the opposite-side GHL outcome badge.
      svg = svg.replace('</svg>', `<g data-warm-lead="true"><rect x="0" y="0" width="18" height="19" rx="5" fill="#587E98" stroke="white" stroke-width="1.3"/><g transform="translate(3.5 3) scale(.053)">${signalR}</g></g></svg>`);
    }
    url = "data:image/svg+xml," + encodeURIComponent(svg);
    if (cache.size > 256) cache.clear();
    cache.set(key, url);
  }
  const label = `${style.label}${warm ? ' · Raydar solar-rated warm lead' : ''}${style.outcome ? ` · GHL ${style.outcome.label}` : ""}${lead.solarCategory ? ` · ${lead.solarCategory} roof` : ""}`;
  const height = Math.round((size * 56) / 48);
  return { url, size, height, label, style };
}
