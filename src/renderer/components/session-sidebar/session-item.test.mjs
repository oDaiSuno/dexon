import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out session row: rename commit rules,
// delete confirmation with the running-session guard, and the collapse toggle.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { SessionItem } = await importTestBundle("session-sidebar-session-item", {
  stdin: {
    contents: 'export { SessionItem } from "./src/renderer/components/session-sidebar/session-item.tsx";',
    resolveDir: projectRoot,
    sourcefile: "session-item-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "session-item-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "session-item" }));
        build.onLoad({ filter: /.*/, namespace: "session-item" }, () => ({
          contents:
            "function stubT(_key, fallback) { return fallback; }\n" +
            'export function useI18n() { return { language: "en", t: stubT }; }',
          loader: "js",
        }));
      },
    },
  ],
});

function session(id, overrides = {}) {
  return {
    id,
    name: "",
    firstMessage: "",
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

const GLOBAL_NAMES = ["window", "fetch", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment() {
  const originals = new Map(GLOBAL_NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const env = {
    alertCalls: [],
    fetchRequests: [],
    nextFetchResponse: () => ({ ok: true, json: async () => ({}) }),
  };
  globalThis.__sessionItemEnv = env;
  globalThis.window = {
    alert: (message) => env.alertCalls.push(message),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (callback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  globalThis.fetch = async (url, options) => {
    env.fetchRequests.push({ url, options });
    return env.nextFetchResponse();
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  env.restore = async () => {
    delete globalThis.__sessionItemEnv;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return env;
}

async function withEnvironment(run) {
  const env = installEnvironment();
  try {
    await run(env);
  } finally {
    env.restore();
  }
}

function nodeText(node) {
  const children = node.children ?? [];
  return children.map((child) => (typeof child === "string" ? child : nodeText(child))).join("");
}

async function mountItem(props = {}) {
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(SessionItem, {
        session: session("s1", { name: "Base session" }),
        isSelected: false,
        onClick: () => {},
        ...props,
      }),
    );
  });
  return {
    renderer,
    unmount: async () => {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

function findButtonByText(root, text) {
  const matches = root.findAll((node) => node.type === "button" && nodeText(node).includes(text));
  assert.equal(matches.length, 1, `expected exactly one button containing ${JSON.stringify(text)}`);
  return matches[0];
}

function findActionsSummary(root) {
  const matches = root.findAll((node) => node.props?.className === "session-actions-summary");
  assert.equal(matches.length, 1, "expected the session actions summary button");
  return matches[0];
}

function click(node) {
  return node.props.onClick({ stopPropagation() {} });
}

async function openActionsMenu(renderer) {
  const summary = findActionsSummary(renderer.root);
  await act(async () => {
    click(summary);
  });
  return summary;
}

async function startRename(mounted) {
  await openActionsMenu(mounted.renderer);
  await act(async () => {
    click(findButtonByText(mounted.renderer.root, "Rename"));
  });
  const inputs = mounted.renderer.root.findAll((node) => node.type === "input");
  assert.equal(inputs.length, 1);
  return inputs[0];
}

test("commits a rename through the session API and notifies the parent", async () => {
  await withEnvironment(async (env) => {
    const renamed = [];
    env.nextFetchResponse = () => ({ ok: true, json: async () => ({}) });
    const mounted = await mountItem({ onRenamed: () => renamed.push("renamed") });
    const input = await startRename(mounted);
    assert.equal(input.props.value, "Base session");
    await act(async () => {
      input.props.onChange({ target: { value: "Renamed session" } });
    });
    await act(async () => {
      input.props.onBlur();
    });
    assert.equal(env.fetchRequests.length, 1);
    const request = env.fetchRequests[0];
    assert.equal(request.url, "/api/sessions/s1");
    assert.equal(request.options.method, "PATCH");
    assert.deepEqual(JSON.parse(request.options.body), { name: "Renamed session" });
    assert.deepEqual(renamed, ["renamed"]);
    await mounted.unmount();
  });
});

test("skips the rename request when the name is unchanged", async () => {
  await withEnvironment(async (env) => {
    const renamed = [];
    const mounted = await mountItem({ onRenamed: () => renamed.push("renamed") });
    const input = await startRename(mounted);
    await act(async () => {
      input.props.onBlur();
    });
    assert.deepEqual(renamed, []);
    assert.equal(env.fetchRequests.length, 0);
    await mounted.unmount();
  });
});

test("blocks deleting a running session behind an alert", async () => {
  await withEnvironment(async (env) => {
    const deleted = [];
    const mounted = await mountItem({ isRunning: true, onDeleted: (id) => deleted.push(id) });
    await openActionsMenu(mounted.renderer);
    await act(async () => {
      click(findButtonByText(mounted.renderer.root, "Delete"));
    });
    assert.equal(env.alertCalls.length, 1);
    assert.deepEqual(deleted, []);
    assert.equal(env.fetchRequests.length, 0);
    assert.equal(
      mounted.renderer.root.findAll((node) => nodeText(node).includes("Delete “")).length,
      0,
      "no inline confirmation should replace the row",
    );
    await mounted.unmount();
  });
});

test("confirms deletion and reports the deleted id", async () => {
  await withEnvironment(async (env) => {
    const deleted = [];
    let resolveDelete;
    env.nextFetchResponse = () =>
      new Promise((resolve) => {
        resolveDelete = resolve;
      });
    const mounted = await mountItem({ onDeleted: (id) => deleted.push(id) });
    await openActionsMenu(mounted.renderer);
    await act(async () => {
      click(findButtonByText(mounted.renderer.root, "Delete"));
    });
    assert.equal(
      mounted.renderer.root.findAll((node) => nodeText(node).includes("Delete “")).length > 0,
      true,
      "the inline confirmation replaces the row",
    );
    const confirmButton = mounted.renderer.root.findAll(
      (node) => node.type === "button" && nodeText(node) === "Delete",
    )[0];
    await act(async () => {
      confirmButton.props.onClick({ stopPropagation() {} });
    });
    assert.equal(env.fetchRequests.length, 1);
    assert.equal(env.fetchRequests[0].url, "/api/sessions/s1");
    assert.equal(env.fetchRequests[0].options.method, "DELETE");
    assert.deepEqual(deleted, []);
    await act(async () => {
      resolveDelete({ ok: true, json: async () => ({}) });
    });
    assert.deepEqual(deleted, ["s1"]);
    await mounted.unmount();
  });
});

test("surfaces delete failures through an alert and keeps the row usable", async () => {
  await withEnvironment(async (env) => {
    const deleted = [];
    env.nextFetchResponse = () => ({ ok: false, json: async () => ({ error: "denied" }) });
    const mounted = await mountItem({ onDeleted: (id) => deleted.push(id) });
    await openActionsMenu(mounted.renderer);
    await act(async () => {
      click(findButtonByText(mounted.renderer.root, "Delete"));
    });
    const confirmButton = mounted.renderer.root.findAll(
      (node) => node.type === "button" && nodeText(node) === "Delete",
    )[0];
    await act(async () => {
      confirmButton.props.onClick({ stopPropagation() {} });
    });
    assert.deepEqual(deleted, []);
    assert.equal(env.alertCalls.length, 1);
    assert.equal(env.alertCalls[0], "denied");
    assert.equal(
      mounted.renderer.root.findAll((node) => nodeText(node).includes("Base session")).length > 0,
      true,
      "the row returns to its normal view after a failed delete",
    );
    await mounted.unmount();
  });
});

test("toggles fork collapse from the row button", async () => {
  await withEnvironment(async () => {
    let toggles = 0;
    const mounted = await mountItem({ hasChildren: true, onToggleCollapse: () => (toggles += 1) });
    const toggle = mounted.renderer.root.findAll(
      (node) => node.type === "button" && node.props["aria-label"] === "Collapse forks",
    )[0];
    assert.ok(toggle, "expected the collapse toggle on a row with children");
    await act(async () => {
      toggle.props.onClick({ stopPropagation() {} });
    });
    assert.equal(toggles, 1);
    await mounted.unmount();
  });
});

test("closes the actions menu on Escape", async () => {
  await withEnvironment(async () => {
    const mounted = await mountItem();
    await openActionsMenu(mounted.renderer);
    assert.equal(mounted.renderer.root.findAll((node) => node.props?.role === "menu").length, 1);
    const wrapper = mounted.renderer.root.findAll(
      (node) => node.type === "div" && typeof node.props.onKeyDown === "function",
    )[0];
    await act(async () => {
      wrapper.props.onKeyDown({ key: "Escape", preventDefault() {} });
    });
    assert.equal(mounted.renderer.root.findAll((node) => node.props?.role === "menu").length, 0);
    await mounted.unmount();
  });
});
