import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, keyDown } from "../../../../tests/support/dom-events.mjs";
import { createElement } from "react";
import { act } from "react";

// Contract tests for the project switcher card opened from the current
// project's actions button: the "Current project" group with the project name
// and the home-shortened folder it lives in, then the two approved actions.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { NavSpaceMenu } = await importTestBundle("app-nav-space-menu", {
  stdin: {
    contents: 'export { NavSpaceMenu } from "./src/renderer/components/app-nav/nav-space-menu.tsx";',
    resolveDir: projectRoot,
    sourcefile: "app-nav-space-menu-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

function spaceMenuProps(overrides = {}) {
  const calls = { chooseFolder: 0, back: 0 };
  return {
    props: {
      spaceName: "dexon",
      spacePath: "/Users/tester/Developer/personal/btron/dexon",
      homeDir: "/Users/tester",
      onChooseFolder: () => {
        calls.chooseFolder += 1;
      },
      onBackToPersonalSpace: () => {
        calls.back += 1;
      },
      ...overrides,
    },
    calls,
  };
}

const MENU_ITEMS = ["Add project space from folder…", "Back to personal space"];

function querySelector(container, selector) {
  return container.querySelector(selector);
}

function queryAll(container, selector) {
  return Array.from(container.querySelectorAll(selector));
}

async function openMenu(root) {
  const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
  assert.ok(trigger, "the space name button must be the menu trigger");
  await click(trigger);
  return trigger;
}

test("the card is closed by default and opens with the current project group, the home-shortened path and two actions", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));

    assert.equal(querySelector(dom.window.document.body, '[role="menu"]'), null, "the space menu must start closed");

    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "the trigger must reflect the open menu");

    const menu = querySelector(dom.window.document.body, '[role="menu"]');
    assert.ok(menu, "the space menu must render after opening");
    assert.ok((menu.textContent ?? "").includes("Current project"), "the card labels the current project group");
    const lines = queryAll(menu, "span").map((element) => element.textContent ?? "");
    assert.ok(lines.includes("dexon"), "the card names the current project");
    assert.ok(
      lines.includes("~/Developer/personal/btron"),
      "the card shows the folder that holds the project, with the home folder shortened to ~",
    );
    assert.ok(!(menu.textContent ?? "").includes("/Users/tester"), "the card does not spell out the home folder");
    const items = queryAll(menu, '[role="menuitem"]');
    assert.deepEqual(
      items.map((item) => item.textContent ?? ""),
      MENU_ITEMS,
      "the card must present the two approved space actions in order",
    );
  } finally {
    await root.unmount();
  }
});

test("choosing a space action fires exactly its callback and closes the menu", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);

    const items = queryAll(dom.window.document.body, '[role="menuitem"]');
    const addFolder = items.find((item) => item.textContent === "Add project space from folder…");
    await click(addFolder);

    assert.equal(calls.chooseFolder, 1, "the add-from-folder action must fire once");
    assert.equal(calls.back, 0, "other actions must not fire");
    assert.equal(
      querySelector(root.container, '[aria-haspopup="menu"]').getAttribute("aria-expanded"),
      "false",
      "the action closes the menu",
    );
  } finally {
    await root.unmount();
  }
});

test("Escape closes the space menu", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "menu is open before Escape");
    await keyDown(querySelector(dom.window.document.body, '[role="menuitem"]'), "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "Escape must close the menu");
  } finally {
    await root.unmount();
  }
});

test("a mousedown outside the menu closes it", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "menu is open before the outside click");

    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "outside mousedown must close the menu");
  } finally {
    await root.unmount();
  }
});

test("pressing inside the open card keeps it open", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    const label = queryAll(dom.window.document.body, "span").find((element) => element.textContent === "dexon");
    assert.ok(label, "the card shows the project name");
    await act(async () => {
      label.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "a press inside the card must not close it");
  } finally {
    await root.unmount();
  }
});

test("the keyboard reaches the actions: opening moves focus into the card, arrows walk and wrap, Escape returns to the button", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    const menu = querySelector(dom.window.document.body, '[role="menu"]');
    const focused = () => dom.window.document.activeElement;
    assert.ok(menu.contains(focused()), "opening the card moves keyboard focus into it");
    await keyDown(focused(), "ArrowDown");
    assert.equal(focused().textContent, MENU_ITEMS[0], "ArrowDown reaches the first action");
    await keyDown(focused(), "ArrowDown");
    assert.equal(focused().textContent, MENU_ITEMS[1], "ArrowDown moves to the next action");
    await keyDown(focused(), "ArrowDown");
    assert.equal(focused().textContent, MENU_ITEMS[0], "ArrowDown wraps to the first action");
    await keyDown(focused(), "ArrowUp");
    assert.equal(focused().textContent, MENU_ITEMS[1], "ArrowUp wraps to the last action");
    await keyDown(focused(), "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "Escape closes the card");
    assert.equal(focused(), trigger, "Escape returns keyboard focus to the actions button");
  } finally {
    await root.unmount();
  }
});

test("scrolling anything behind the open card closes it, so the card never drifts away from its project", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "card is open before the scroll");
    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.Event("scroll"));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "a scroll outside the card must close it");
  } finally {
    await root.unmount();
  }
});

test("resizing the window closes the open card", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "card is open before the resize");
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("resize"));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "a window resize must close the card");
  } finally {
    await root.unmount();
  }
});

test("the menu trigger is named after the project it acts on", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
    assert.equal(trigger.getAttribute("aria-label"), "Actions for dexon");
    assert.equal(
      trigger.title,
      "/Users/tester/Developer/personal/btron/dexon",
      "the tooltip keeps the full folder path",
    );
  } finally {
    await root.unmount();
  }
});
