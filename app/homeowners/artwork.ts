import type { Lead } from "@/app/types";
import type { Disposition } from "@/app/types/disposition";
import { fieldPinArtwork } from "@/app/utils/fieldPin";
/** Reuse the shipped silhouette/glyph/zoom sizes. Only the gray states are new. */
export function homeownerPinArtwork(
  renter: boolean,
  zoom: number,
  selected = false,
) {
  const pin = fieldPinArtwork(
    { status: "not-knocked" } as Lead,
    {
      name: renter ? "Suspected renter" : "Owner",
      color: renter ? "#9b9da1" : "#7e8893",
    } as Disposition,
    zoom,
    selected,
  );
  let svg = decodeURIComponent(pin.url.slice(pin.url.indexOf(",") + 1))
    .replaceAll("#173240", "#626c78")
    .replaceAll("#91a8b4", "#d5d9df");
  if (renter)
    svg = svg.replace(
      "</svg>",
      '<g data-renter="true"><rect x="29" y="0" width="19" height="18" rx="6" fill="#6b7078" stroke="white" stroke-width="1.5"/><text x="38.5" y="13" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="12">?</text></g></svg>',
    );
  return { ...pin, url: "data:image/svg+xml," + encodeURIComponent(svg) };
}
