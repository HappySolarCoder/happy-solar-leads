/** Android Back dismisses the top sheet before leaving the page. */
export function dismissMobileOverlay(root: Document = document) {
  const dialog = [
    ...root.querySelectorAll<HTMLDialogElement>("dialog[open]"),
  ].at(-1);
  if (dialog) {
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    if (!event.defaultPrevented) dialog.close();
    return true;
  }
  const close = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-raydar-back-close]"),
  ]
    .filter((b) => !b.disabled && b.getClientRects().length > 0)
    .at(-1);
  if (close) {
    close.click();
    return true;
  }
  return false;
}
