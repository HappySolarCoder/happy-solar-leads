/** Where the assignee dialog has to mount so a phone can tap a searched name.
 *
 * The trigger sits in a <label> inside the territory sheet. That sheet is
 * transformed and overflow-hidden. A modal left in that tree is not tappable
 * once Search names is focused: the tap is taken by the label, or it lands on
 * the backdrop after the keyboard moves the dialog. The shell is outside both.
 */
export function preferredAssigneeHost<T>(
  matches: Array<T | null | undefined>,
  fallback: T
): T {
  return matches.find((item): item is T => item != null) ?? fallback;
}

export function assigneeDialogHost(
  anchor: { closest(selector: string): Element | null } | null,
  fallback: HTMLElement
): HTMLElement {
  return preferredAssigneeHost(
    [anchor?.closest(".rt-shell"), anchor?.closest(".raydar-mobile")].map((node) =>
      node instanceof HTMLElement ? node : null
    ),
    fallback
  );
}

/** Selecting a searched person applies that id and closes the picker. */
export function chooseSearchedPerson(
  id: string,
  onChange: (id: string) => void
): { open: false; query: string } {
  onChange(id);
  return { open: false, query: "" };
}
