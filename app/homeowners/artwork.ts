/** Compact at neighborhood zoom; a clearer circle at roof zoom. No roof polygons are available. */
export function homeownerPinArtwork(
  _renter: boolean,
  zoom: number,
  selected = false,
) {
  const normal = zoom < 17 ? 7 : zoom < 18 ? 13.5 : zoom < 19 ? 21 : 27;
  const size = selected ? normal + 6 : normal;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${selected ? '<circle cx="10" cy="10" r="9" fill="none" stroke="#F4C84A" stroke-width="2"/>' : ''}<circle cx="10" cy="10" r="7.5" fill="#476E88" stroke="#fffcf5" stroke-width="1.5"/></svg>`;
  return {
    url: "data:image/svg+xml," + encodeURIComponent(svg),
    size,
    height: size,
    anchorX: size / 2,
    anchorY: size / 2,
  };
}
