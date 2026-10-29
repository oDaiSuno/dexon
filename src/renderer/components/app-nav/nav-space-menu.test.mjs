import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, keyDown } from "../../../../tests/support/dom-events.mjs";
import { accessibleName } from "../../../../tests/support/dom-queries.mjs";
import { createElement } from "react";
import { act } from "react";

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

const ROW_ACTIONS = ["Move up", "Move down", "Close project"];

function rowMenuProps(overrides = {}) {
  const calls = { moveUp: 0, moveDown: 0, close: 0 };
  return {
    props: {
      spaceName: "dexon",
      projectPath: "/Users/tester/Developer/personal/btron/dexon",
      canMoveUp: true,
      canMoveDown: true,
      canClose: true,
      onMoveUp: () => {
        calls.moveUp += 1;
      },
      onMoveDown: () => {
        calls.moveDown += 1;
      },
      onClose: () => {
        calls.close += 1;
      },
      ...overrides,
    },
    calls,
  };
}

function querySelector(container, selector) {
  return container.querySelector(selector);
}

function queryAll(container, selector) {
  return Array.from(container.querySelectorAll(selector));
}

function openMenu() {
  const menu = querySelector(dom.window.document.body, '[role="menu"]');
  assert.ok(menu, "the row menu is open");
  return menu;
}

function menuItemNames(menu) {
  return queryAll(menu, '[role="menuitem"]').map((item) => accessibleName(item));
}

async function useTrigger(root) {
  const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
  assert.ok(trigger, "the actions button is the menu trigger");
  await click(trigger);
  return trigger;
}

test("a row's actions button opens a menu holding Move up, Move down and Close project, and nothing that leaves the project", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    assert.equal(querySelector(dom.window.document.body, '[role="menu"]'), null, "the row menu starts closed");
    const trigger = await useTrigger(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "the trigger says the menu is open");
    assert.deepEqual(menuItemNames(openMenu()), ROW_ACTIONS, "a row offers exactly these three actions, in order");
  } finally {
    await root.unmount();
  }
});

test("choosing one action runs it once and closes the menu", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    const moveDown = queryAll(openMenu(), '[role="menuitem"]').find((item) => accessibleName(item) === "Move down");
    assert.ok(moveDown, "the menu offers Move down");
    await click(moveDown);
    assert.deepEqual(calls, { moveUp: 0, moveDown: 1, close: 0 }, "only the chosen action runs");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "the menu closes after the action");
  } finally {
    await root.unmount();
  }
});

test("Escape closes the menu and hands the keyboard back to the actions button", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    await keyDown(openMenu(), "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.ok(dom.window.document.activeElement === trigger, "the keyboard returns to the button that opened the menu");
  } finally {
    await root.unmount();
  }
});

test("opening the menu puts the keyboard in it and the arrow keys walk its usable actions", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await useTrigger(root);
    const menu = openMenu();
    const focused = () => dom.window.document.activeElement;
    assert.ok(focused() === menu, "the open menu takes keyboard focus");
    await keyDown(menu, "ArrowDown");
    assert.equal(accessibleName(focused()), ROW_ACTIONS[0]);
    await keyDown(focused(), "ArrowDown");
    assert.equal(accessibleName(focused()), ROW_ACTIONS[1]);
    await keyDown(focused(), "ArrowUp");
    assert.equal(accessibleName(focused()), ROW_ACTIONS[0]);
  } finally {
    await root.unmount();
  }
});

test("an action that cannot be used is stepped over by the arrow keys", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps({ canMoveUp: false });
    await root.render(createElement(NavSpaceMenu, props));
    await useTrigger(root);
    const menu = openMenu();
    await keyDown(menu, "ArrowDown");
    assert.equal(accessibleName(dom.window.document.activeElement), "Move down", "the unusable Move up is skipped");
  } finally {
    await root.unmount();
  }
});

test("the menu names the folder it acts on in its tooltip and its own label", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
    assert.equal(trigger.getAttribute("aria-label"), "Actions for dexon");
    assert.equal(trigger.title, "/Users/tester/Developer/personal/btron/dexon");
  } finally {
    await root.unmount();
  }
});

test("a mousedown outside the menu closes it", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "a press outside closes the menu");
  } finally {
    await root.unmount();
  }
});

test("a press inside the open menu keeps it open", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    const label = queryAll(openMenu(), "span").find((element) => element.textContent === "Move up");
    assert.ok(label, "the menu shows its actions");
    await act(async () => {
      label.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "a press inside the menu must not close it");
  } finally {
    await root.unmount();
  }
});

test("scrolling anything behind the open menu closes it, so it never drifts away from its row", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.Event("scroll"));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "a scroll outside the menu closes it");
  } finally {
    await root.unmount();
  }
});

test("resizing the window closes the open menu", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = rowMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await useTrigger(root);
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("resize"));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "a window resize closes the menu");
  } finally {
    await root.unmount();
  }
});
