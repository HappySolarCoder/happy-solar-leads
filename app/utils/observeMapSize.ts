// Banners and native insets resize a map without a window resize event.
// Preserve the user's location and zoom while loading tiles for the new area.
export function observeMapSize(map: {
  getContainer(): HTMLElement;
  invalidateSize(options: { pan: boolean; debounceMoveend: boolean }): unknown;
}) {
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() =>
      map.invalidateSize({ pan: false, debounceMoveend: true })
    );
  });
  observer.observe(map.getContainer());
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
