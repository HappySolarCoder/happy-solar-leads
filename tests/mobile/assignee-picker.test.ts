import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  preferredAssigneeHost,
  chooseSearchedPerson,
} from "../../app/mobile/_lib/assigneePicker";

test("assignee dialog prefers the shell over the page, never the sheet or label", () => {
  const shell = { id: "shell" };
  const mobile = { id: "mobile" };
  const body = { id: "body" };
  assert.equal(preferredAssigneeHost([shell, mobile], body), shell);
  assert.equal(preferredAssigneeHost([null, mobile], body), mobile);
  assert.equal(preferredAssigneeHost([undefined, null], body), body);
  const source = readFileSync(
    new URL("../../app/mobile/_lib/assigneePicker.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /closest\("\.rt-shell"\)/);
  assert.match(source, /closest\("\.raydar-mobile"\)/);
  assert.equal(source.includes('.rt-sheet'), false);
  assert.equal(source.includes("closest(\"label\")"), false);
});

test("choosing a searched person selects them and closes the picker", () => {
  const seen: string[] = [];
  const next = chooseSearchedPerson("marissa", (id) => seen.push(id));
  assert.deepEqual(seen, ["marissa"]);
  assert.deepEqual(next, { open: false, query: "" });
});

test("the picker portals the dialog and keeps taps while search is focused", () => {
  const source = readFileSync(
    new URL("../../app/mobile/_components/PersonPicker.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /createPortal/);
  assert.match(source, /assigneeDialogHost/);
  assert.match(source, /chooseSearchedPerson/);
  assert.match(source, /onPointerDown=\{\(event\) => tap\(event/);
  assert.match(source, /preventDefault\(\)/);
  assert.equal(source.includes('type="button"'), true);
  const workspace = readFileSync(
    new URL("../../app/mobile/territories/TerritoryWorkspace.tsx", import.meta.url),
    "utf8"
  );
  assert.match(workspace, /label="Assign to"/);
});
