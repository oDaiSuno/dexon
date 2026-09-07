import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (fixture contract).
import { dom, createManagedDomRoot, reactPropsOf, restoreGlobals } from "../resource-dom-environment.mjs";
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
  plugins: [
    {
      name: "app-nav-space-menu-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "app-nav-space-menu" }));
        build.onResolve({ filter: /\.png$/ }, () => ({ path: "png", namespace: "app-nav-space-menu" }));
        build.onLoad({ filter: /.*/, namespace: "app-nav-space-menu" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : 'export default "data:image/png;base64,";',
          loader: "js",
        }));
      },
    },
  ],
});

function spaceMenuProps(overrides = {}) {
  const calls = { toggle: 0, openFolder: 0, chooseFolder: 0, switchSpace: 0, back: 0 };
  return {
    props: {
      spaceName: "Personal space",
      spacePath: "~/.dexon",
      onToggleExpanded: () => {
        calls.toggle += 1;
      },
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

// AnimatedDropdown keeps a closed menu mounted for its 140ms fade; the closed
// state is the wrapper's opacity (same assertion convention as the sidebar
// pickers tests).
function menuWrapperOf(root) {
  const menu = querySelector(root.container, '[role="menu"]');
  return menu ? menu.parentElement : null;
}

async function openMenu(root) {
  const trigger = querySelector(root.container, '[aria-haspopup="menu"]');
  assert.ok(trigger, "the space name button must be the menu trigger");
  await act(async () => {
    reactPropsOf(trigger).onClick({ stopPropagation() {} });
  });
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
    await act(async () => {
      reactPropsOf(openFolder).onClick({ stopPropagation() {} });
    });

    assert.equal(calls.openFolder, 1, "open-folder action must fire once");
    assert.equal(calls.chooseFolder, 0, "other actions must not fire");
    assert.equal(menuWrapperOf(root)?.style.opacity, "0", "the menu must fade out after the action");
  } finally {
    await root.unmount();
  }
});

test("Escape closes the space menu", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    assert.equal(menuWrapperOf(root)?.style.opacity, "1", "menu is open before Escape");

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(menuWrapperOf(root)?.style.opacity, "0", "Escape must close the menu");
  } finally {
    await root.unmount();
  }
});

test("a mousedown outside the menu closes it", async () => {
  const root = createManagedDomRoot();
  try {
    const { props } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));
    await openMenu(root);
    assert.equal(menuWrapperOf(root)?.style.opacity, "1", "menu is open before the outside click");

    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    });
    assert.equal(menuWrapperOf(root)?.style.opacity, "0", "outside mousedown must close the menu");
  } finally {
    await root.unmount();
  }
});

test("the top row carries the collapse toggle and the decorative app icon", async () => {
  const root = createManagedDomRoot();
  try {
    const { props, calls } = spaceMenuProps();
    await root.render(createElement(NavSpaceMenu, props));

    const toggle = querySelector(root.container, '[aria-label="Hide sidebar"]');
    assert.ok(toggle, "the collapse toggle must be part of the top space row");
    await act(async () => {
      reactPropsOf(toggle).onClick();
    });
    assert.equal(calls.toggle, 1, "the toggle must hand control to the sidebar owner");

    const icon = querySelector(root.container, "img");
    assert.ok(icon, "the app icon must be visible in the top space row");
    assert.equal(icon.getAttribute("aria-hidden"), "true", "the app icon must stay decorative");
  } finally {
    await root.unmount();
  }
});
