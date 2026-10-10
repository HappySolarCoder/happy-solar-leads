import test from "node:test";
import assert from "node:assert/strict";
import { dismissMobileOverlay } from "../../app/utils/dismissMobileOverlay";
import {
  isDeviceOnline,
  updateNativeConnectivity,
} from "../../app/utils/connectivity";
test("Android Back closes the top dialog or detail before page navigation", () => {
  let closed = 0,
    clicked = "";
  const dialog = {
    dispatchEvent: (e: Event) => {
      e.preventDefault();
      closed++;
    },
    close: () => {
      throw Error("Do not close twice");
    },
  };
  assert.equal(
    dismissMobileOverlay({
      querySelectorAll: () => [dialog],
    } as unknown as Document),
    true,
  );
  assert.equal(closed, 1);
  const buttons = [
    {
      disabled: false,
      getClientRects: () => [1],
      click: () => {
        clicked = "parent";
      },
    },
    {
      disabled: false,
      getClientRects: () => [1],
      click: () => {
        clicked = "child";
      },
    },
  ];
  assert.equal(
    dismissMobileOverlay({
      querySelectorAll: (selector: string) =>
        selector === "dialog[open]" ? [] : buttons,
    } as unknown as Document),
    true,
  );
  assert.equal(clicked, "child");
  assert.equal(
    dismissMobileOverlay({ querySelectorAll: () => [] } as unknown as Document),
    false,
  );
});
test("native connectivity overrides stale browser state and signals listeners", () => {
  const old = globalThis.window;
  globalThis.window = new EventTarget() as unknown as Window &
    typeof globalThis;
  let changes = 0;
  window.addEventListener("raydar-network-change", () => changes++);
  updateNativeConnectivity(false);
  assert.equal(isDeviceOnline(), false);
  updateNativeConnectivity(true);
  assert.equal(isDeviceOnline(), true);
  assert.equal(changes, 2);
  globalThis.window = old;
});
