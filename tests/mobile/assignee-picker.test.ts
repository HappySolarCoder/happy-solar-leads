import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;
const target = globalThis as unknown as Record<string, unknown>;
const view = window as unknown as Record<string, unknown>;
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLDialogElement",
  "Element",
  "Node",
  "SVGElement",
  "DocumentFragment",
  "Event",
  "PointerEvent",
  "MouseEvent",
  "KeyboardEvent",
  "InputEvent",
  "MutationObserver",
]) {
  target[name] = view[name];
}
target.getComputedStyle = window.getComputedStyle.bind(window);
target.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  this.open = false;
};

type Person = { id: string; name: string; detail?: string };
type PickerProps = {
  label?: string;
  value?: string;
  options: Person[];
  allowAll?: boolean;
  onChange: (id: string) => void;
};

type LoadedPicker = {
  act: typeof import("react").act;
  createElement: typeof import("react").createElement;
  createRoot: typeof import("react-dom/client").createRoot;
  PersonPicker: typeof import("../../app/mobile/_components/PersonPicker").default;
};

let loaded: LoadedPicker | undefined;

async function loadPicker(): Promise<LoadedPicker> {
  if (loaded) return loaded;
  const react = await import("react");
  const client = await import("react-dom/client");
  loaded = {
    act: react.act,
    createElement: react.createElement,
    createRoot: client.createRoot,
    PersonPicker: (await import("../../app/mobile/_components/PersonPicker")).default,
  };
  return loaded;
}

async function step(run: () => void | Promise<void>) {
  const { act } = await loadPicker();
  await act(run);
}

function buttonNamed(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((button) => {
    return button.getAttribute("aria-label") === name || button.textContent?.trim() === name;
  });
  assert.ok(found instanceof HTMLButtonElement, name);
  return found;
}

function pointerDown(target: HTMLElement, primary = true) {
  const event = new PointerEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    isPrimary: primary,
    button: 0,
  });
  target.dispatchEvent(event);
  return event;
}

function click(target: HTMLElement, detail: number) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
}

async function mount(props: PickerProps) {
  const { createElement, createRoot, PersonPicker } = await loadPicker();
  const shell = document.createElement("div");
  shell.className = "rt-shell";
  const sheet = document.createElement("div");
  sheet.className = "rt-sheet";
  const label = document.createElement("label");
  shell.append(sheet);
  sheet.append(label);
  document.body.append(shell);
  const root = createRoot(label);
  await step(async () => {
    root.render(createElement(PersonPicker, {
      label: props.label ?? "Assign to",
      value: props.value ?? "",
      options: props.options,
      allowAll: props.allowAll,
      onChange: props.onChange,
    }));
  });
  return {
    shell,
    sheet,
    async open() {
      await step(async () => {
        buttonNamed("Assign to: Choose a user").click();
      });
      const dialog = document.querySelector("dialog");
      assert.ok(dialog);
      assert.equal(shell.contains(dialog), true);
      assert.equal(sheet.contains(dialog), false);
      assert.equal(label.contains(dialog), false);
    },
    async cleanup() {
      await step(async () => {
        root.unmount();
      });
      shell.remove();
    },
  };
}

const people: Person[] = [
  { id: "marissa", name: "Marissa Cole", detail: "Setter" },
  { id: "jordan", name: "Jordan Lee", detail: "Closer" },
];

function directory() {
  return Array.from({ length: 30 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return { id: `rep-${number}`, name: `Rep ${number}` };
  });
}

function pageLabel() {
  return document.querySelector(".rm-directory-paging span")?.textContent;
}

test("a tap selects exactly once", async () => {
  const chosen: string[] = [];
  const view = await mount({ options: people, onChange: (id) => chosen.push(id) });
  try {
    await view.open();
    const name = buttonNamed("Select Marissa Cole");
    let prevented = false;
    await step(async () => {
      prevented = pointerDown(name).defaultPrevented;
      click(name, 1);
    });
    assert.equal(prevented, true);
    assert.deepEqual(chosen, ["marissa"]);
    assert.equal(document.querySelector('[aria-label="Search users"]'), null);
  } finally {
    await view.cleanup();
  }
});

test("a pointerdown with no click selects nothing", async () => {
  const chosen: string[] = [];
  const view = await mount({ options: people, onChange: (id) => chosen.push(id) });
  try {
    await view.open();
    await step(async () => {
      pointerDown(buttonNamed("Select Marissa Cole"));
    });
    assert.deepEqual(chosen, []);
    assert.ok(document.querySelector('[aria-label="Search users"]'));
    assert.ok(document.querySelector('[aria-label="Select Marissa Cole"]'));
  } finally {
    await view.cleanup();
  }
});

test("disabled Previous on page 0 doesn't change the page", async () => {
  const view = await mount({ options: directory(), onChange: () => {} });
  try {
    await view.open();
    const previous = buttonNamed("Previous");
    assert.equal(previous.disabled, true);
    assert.equal(pageLabel(), "1\u201325 of 30");
    assert.equal(document.querySelector(".rm-person-results strong")?.textContent, "Rep 01");
    await step(async () => {
      pointerDown(previous);
      click(previous, 1);
    });
    assert.equal(pageLabel(), "1\u201325 of 30");
    assert.equal(document.querySelector(".rm-person-results strong")?.textContent, "Rep 01");
    const next = buttonNamed("Next");
    await step(async () => {
      click(next, 1);
    });
    assert.equal(pageLabel(), "26\u201330 of 30");
    assert.equal(next.disabled, true);
    await step(async () => {
      pointerDown(next);
      click(next, 1);
    });
    assert.equal(pageLabel(), "26\u201330 of 30");
    assert.equal(document.querySelector(".rm-person-results strong")?.textContent, "Rep 26");
  } finally {
    await view.cleanup();
  }
});

test("the X closes", async () => {
  const chosen: string[] = [];
  const view = await mount({ options: people, onChange: (id) => chosen.push(id) });
  try {
    await view.open();
    const close = buttonNamed("Close Assign to");
    await step(async () => {
      pointerDown(close);
    });
    assert.ok(document.querySelector('[aria-label="Search users"]'));
    await step(async () => {
      click(close, 1);
    });
    assert.equal(document.querySelector('[aria-label="Search users"]'), null);
    assert.equal(document.querySelector('[aria-label="Close Assign to"]'), null);
    assert.deepEqual(chosen, []);
  } finally {
    await view.cleanup();
  }
});

test("keyboard Enter selects", async () => {
  const chosen: string[] = [];
  const view = await mount({ options: people, onChange: (id) => chosen.push(id) });
  try {
    await view.open();
    const name = buttonNamed("Select Jordan Lee");
    name.focus();
    await step(async () => {
      name.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }));
    });
    assert.deepEqual(chosen, []);
    // Keyboard activation delivers a click whose detail is 0.
    await step(async () => {
      click(name, 0);
    });
    assert.deepEqual(chosen, ["jordan"]);
    assert.equal(document.querySelector('[aria-label="Search users"]'), null);
  } finally {
    await view.cleanup();
  }
});
