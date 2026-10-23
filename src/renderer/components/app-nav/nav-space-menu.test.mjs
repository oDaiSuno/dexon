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

// Phase 4 contract tests for the top space area: app icon + friendly space
// name + collapse toggle, and the space menu holding the abbreviated path
// line plus the four approved space actions.

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
  const calls = { openFolder: 0, chooseFolder: 0, switchSpace: 0, back: 0 };
  return {
    props: {
      spaceName: "Personal space",
      spacePath: "~/.dexon",
      onOpenFolder: () => {
        calls.openFolder += 1;
      },
      onChooseFolder: () => {
        calls.chooseFolder += 1;
      },
      onSwitchSpace: () => {
        calls.switchSpace += 1;
      },
      onBackToPersonalSpace: () => {
        calls.back += 1;
      },
      ...overrides,
    },
    calls,
  };
}

const MENU_ITEMS = ["Open current folder", "Choose another folder…", "Switch space…", "Back to personal space"];

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

test("the menu is closed by default and opens with the path line and four actions", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));

    assert.equal(querySelector(root.container, '[role="menu"]'), null, "the space menu must start closed");

    const trigger = await openMenu(root);
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "the trigger must reflect the open menu");

    const menu = querySelector(root.container, '[role="menu"]');
    assert.ok(menu, "the space menu must render after opening");
    assert.match(menu.textContent ?? "", /~\/\.dexon/, "the menu shows the abbreviated space path");
    const items = queryAll(root.container, '[role="menuitem"]');
    assert.deepEqual(
      items.map((item) => item.textContent ?? ""),
      MENU_ITEMS,
      "the menu must present the four approved space actions in order",
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

    const items = queryAll(root.container, '[role="menuitem"]');
    const openFolder = items.find((item) => item.textContent === "Open current folder");
    await click(openFolder);

    assert.equal(calls.openFolder, 1, "open-folder action must fire once");
    assert.equal(calls.chooseFolder, 0, "other actions must not fire");
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
    await keyDown(querySelector(root.container, '[role="menuitem"]'), "Escape");
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

test("the menu trigger is named after the project it acts on", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
    assert.equal(trigger.getAttribute("aria-label"), "Actions for Personal space");
  } finally {
    await root.unmount();
  }
});
