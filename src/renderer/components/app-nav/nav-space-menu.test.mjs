import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, input, keyDown, waitFor } from "../../../../tests/support/dom-events.mjs";
import { accessibleName } from "../../../../tests/support/dom-queries.mjs";
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

const KNOWN_PROJECTS = [
  { root: "/work/alpha-site", name: "alpha-site" },
  { root: "/srv/tools/beta", name: "beta" },
];
const EXISTING_FOLDERS = { "~/code/new-app": "/Users/tester/code/new-app", "/opt/shared": "/opt/shared" };

function spaceMenuProps(overrides = {}) {
  const calls = { chooseFolder: 0, back: 0, opened: [] };
  return {
    props: {
      spaceName: "dexon",
      projectPath: "/Users/tester/Developer/personal/btron/dexon",
      homeDir: "/Users/tester",
      projects: KNOWN_PROJECTS,
      onChooseFolder: () => {
        calls.chooseFolder += 1;
      },
      onBackToPersonalSpace: () => {
        calls.back += 1;
      },
      onOpenFolder: (folder) => {
        calls.opened.push(folder);
      },
      inspectFolder: async (typed) => EXISTING_FOLDERS[typed] ?? null,
      ...overrides,
    },
    calls,
  };
}

function searchBox() {
  const menu = querySelector(dom.window.document.body, '[role="menu"]');
  assert.ok(menu, "the card is open");
  const box = querySelector(menu, '[role="searchbox"]');
  assert.ok(box, "the card has a search box");
  return box;
}

function menuItemNames() {
  return queryAll(dom.window.document.body, '[role="menuitem"]').map((item) => accessibleName(item));
}

function highlighted() {
  const id = searchBox().getAttribute("aria-activedescendant");
  if (!id) return null;
  const element = dom.window.document.getElementById(id);
  assert.ok(element, "the highlighted id points at a row in the card");
  return accessibleName(element);
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
      items.map((item) => accessibleName(item)),
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
    const addFolder = items.find((item) => accessibleName(item) === "Add project space from folder…");
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

test("the keyboard reaches the actions: opening puts focus in the search box, arrows move the highlight and wrap, Escape returns to the button", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    const box = searchBox();
    const focused = () => dom.window.document.activeElement;
    assert.equal(focused(), box, "opening the card puts keyboard focus in the search box");
    assert.equal(highlighted(), null, "nothing is highlighted before the first arrow press");
    await keyDown(box, "ArrowDown");
    assert.equal(highlighted(), MENU_ITEMS[0], "ArrowDown reaches the first action");
    await keyDown(box, "ArrowDown");
    assert.equal(highlighted(), MENU_ITEMS[1], "ArrowDown moves to the next action");
    await keyDown(box, "ArrowDown");
    assert.equal(highlighted(), MENU_ITEMS[0], "ArrowDown wraps to the first action");
    await keyDown(box, "ArrowUp");
    assert.equal(highlighted(), MENU_ITEMS[1], "ArrowUp wraps to the last action");
    assert.equal(focused(), box, "moving the highlight keeps typing in the search box");
    await keyDown(box, "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "Escape closes the card");
    assert.equal(focused(), trigger, "Escape returns keyboard focus to the actions button");
  } finally {
    await root.unmount();
  }
});

test("Enter opens the highlighted action, closes the card and gives focus back to the button", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    await keyDown(searchBox(), "ArrowUp");
    assert.equal(highlighted(), "Back to personal space");
    await keyDown(searchBox(), "Enter");
    assert.equal(calls.back, 1, "Enter runs the highlighted action once");
    assert.equal(calls.chooseFolder, 0, "no other action runs");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "Enter closes the card");
    assert.equal(dom.window.document.activeElement, trigger, "focus goes back to the actions button");
  } finally {
    await root.unmount();
  }
});

test("Enter with nothing highlighted does nothing", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    await keyDown(searchBox(), "Enter");
    assert.deepEqual(calls, { chooseFolder: 0, back: 0, opened: [] });
    assert.equal(trigger.getAttribute("aria-expanded"), "true", "the card stays open");
  } finally {
    await root.unmount();
  }
});

test("the card shows the search row with its shortcut and the key hints at the bottom", async () => {
  const root = createManagedDomRoot();
  const previousBridge = dom.window.piBridge;
  dom.window.piBridge = { ...previousBridge, platform: "darwin" };
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    const box = searchBox();
    assert.equal(accessibleName(box), "Search or open a project…", "the search box is named after its purpose");
    assert.equal(box.getAttribute("placeholder"), "Search or open a project…", "the empty search box shows the prompt");
    const menu = querySelector(dom.window.document.body, '[role="menu"]');
    const lines = queryAll(menu, "span,kbd").map((element) => (element.textContent ?? "").trim());
    assert.ok(lines.includes("⌘P"), "the search row shows the shortcut that opens this card");
    for (const hint of ["↑↓", "Select", "↵", "Open", "esc", "Close"]) {
      assert.ok(lines.includes(hint), `the key hints include ${hint}`);
    }
  } finally {
    dom.window.piBridge = previousBridge;
    await root.unmount();
  }
});

test("typing filters the known projects by name or by folder, and Enter opens the first match", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    await input(searchBox(), "ALPHA");
    assert.deepEqual(menuItemNames(), ["alpha-site", ...MENU_ITEMS], "a name match is listed above the actions");
    assert.equal(highlighted(), "alpha-site", "the first match is highlighted while searching");
    await input(searchBox(), "srv/tools");
    assert.deepEqual(menuItemNames(), ["beta", ...MENU_ITEMS], "a folder match counts too");
    await keyDown(searchBox(), "Enter");
    assert.deepEqual(calls.opened, ["/srv/tools/beta"], "Enter opens the highlighted project's folder");
    assert.equal(trigger.getAttribute("aria-expanded"), "false", "opening a project closes the card");
  } finally {
    await root.unmount();
  }
});

test("closing the card forgets the search, so it opens empty next time", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    await input(searchBox(), "alpha");
    await keyDown(searchBox(), "Escape");
    await openMenu(root);
    assert.equal(searchBox().value, "", "the search box starts empty");
    assert.deepEqual(menuItemNames(), MENU_ITEMS, "no project matches are left over");
  } finally {
    await root.unmount();
  }
});

test("a search with no matching project says so and keeps the actions", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    await input(searchBox(), "zzz");
    assert.deepEqual(menuItemNames(), MENU_ITEMS, "only the actions remain");
    assert.ok(
      (querySelector(dom.window.document.body, '[role="menu"]').textContent ?? "").includes("No matching projects"),
      "the card says nothing matched",
    );
  } finally {
    await root.unmount();
  }
});

test("typing an existing folder path offers to open it first, and Enter opens that folder", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    const trigger = await openMenu(root);
    await input(searchBox(), "~/code/new-app");
    await waitFor(() => assert.equal(menuItemNames()[0], "Open ~/code/new-app"));
    assert.equal(highlighted(), "Open ~/code/new-app", "the open-folder row is highlighted first");
    await keyDown(searchBox(), "Enter");
    assert.deepEqual(calls.opened, ["/Users/tester/code/new-app"], "Enter opens the folder the Host resolved");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
  } finally {
    await root.unmount();
  }
});

test("a folder path that does not exist is not offered", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    await input(searchBox(), "~/code/missing");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.deepEqual(menuItemNames(), MENU_ITEMS, "no open-folder row for a missing folder");
  } finally {
    await root.unmount();
  }
});

test("after a folder was found, changing the text removes the offer at once, so Enter never opens the old folder", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    await input(searchBox(), "~/code/new-app");
    await waitFor(() => assert.equal(menuItemNames()[0], "Open ~/code/new-app"));
    await input(searchBox(), "alpha");
    assert.deepEqual(menuItemNames(), ["alpha-site", ...MENU_ITEMS], "the earlier folder is no longer offered");
  } finally {
    await root.unmount();
  }
});

test("a late answer for an earlier path does not offer to open it after the search changed", async () => {
  const root = createManagedDomRoot();
  try {
    let answer;
    const { props } = spaceMenuProps({
      inspectFolder: (typed) =>
        typed === "/opt/shared"
          ? new Promise((resolve) => (answer = () => resolve("/opt/shared")))
          : Promise.resolve(null),
    });
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    await input(searchBox(), "/opt/shared");
    await waitFor(() => assert.ok(answer, "the folder check started"));
    await input(searchBox(), "alpha");
    await act(async () => answer());
    assert.deepEqual(menuItemNames(), ["alpha-site", ...MENU_ITEMS], "the stale folder is not offered");
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
