/** Quiet, centered property marks keep roofs visible. Selection expands only one home. */
export function homeownerPinArtwork(
  renter: boolean,
  zoom: number,
  selected = false,
) {
  const size = selected ? 16 : zoom < 17 ? 6 : zoom < 18 ? 7 : 8;
  const shape = renter
    ? '<path data-renter="true" d="m10 3 7 7-7 7-7-7z"'
    : '<circle cx="10" cy="10" r="6"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${selected ? '<circle cx="10" cy="10" r="9" fill="none" stroke="#00c4d0" stroke-width="2"/>' : ''}${shape} fill="none" stroke="#fffcf5" stroke-width="4"/>${shape} fill="#e6edf2" fill-opacity=".35" stroke="#617182" stroke-width="1.8"/></svg>`;
  return {
    url: "data:image/svg+xml," + encodeURIComponent(svg),
    size,
    height: size,
    anchorX: size / 2,
    anchorY: size / 2,
  };
}
