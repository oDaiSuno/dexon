import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { createDeferredHost, hostError } from "../../../../tests/support/deferred-host.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import { createManagedDomRoot, dom, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, input, keyDown } from "../../../../tests/support/dom-events.mjs";
import { act, createElement } from "react";

// Real-DOM characterization tests for the split add-skill panel: catalog
// search, empty results, install success/failure accounting, and the
// capability repair prompt that retries or cancels the pending install.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { AddSkillPanel, resetRpc, installApiShims } = await importTestBundle("skills-add-panel", {
  stdin: {
    contents:
      'export { AddSkillPanel } from "./src/renderer/components/skills/add-skill-panel.tsx"; export {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "add-skill-panel-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

const SEARCH_RESULT = {
  package: "owner/repo@alpha",
  installs: 12,
  url: "https://skills.sh/owner/repo",
};

function installEnvironment() {
  const replies = createDeferredHost(["skills.search", "skills.install"]);
  const boundary = installRendererApi(dom.window, { installApiShims, resetRpc }, () => replies, {
    bridge: {
      platform: "darwin",
      performToolchainAction: async () => {},
      rescanToolchains: async () => {},
    },
  });
  return { pending: replies.pending, restore: boundary.close };
}

let env = null;
let activeManaged = null;

async function withEnvironment(run) {
  env = installEnvironment();
  try {
    await run();
  } finally {
    try {
      await activeManaged?.unmount();
    } finally {
      activeManaged = null;
      env.restore();
      env = null;
    }
  }
}

async function mountPanel() {
  const installed = { count: 0 };
  const managed = createManagedDomRoot();
  activeManaged = managed;
  await managed.render(createElement(AddSkillPanel, { cwd: "/repo", onInstalled: () => (installed.count += 1) }));
  return {
    installed,
    rootEl: () => managed.container,
    input: () => managed.container.querySelector("input"),
    unmount: () => managed.unmount(),
  };
}

async function searchFor(mounted, query, response) {
  const pendingStart = env.pending.length;
  await input(mounted.input(), query);
  await keyDown(mounted.input(), "Enter");
  assert.equal(env.pending[pendingStart].method, "skills.search");
  assert.deepEqual(env.pending[pendingStart].params, { query });
  await act(async () => {
    env.pending[pendingStart].deferred.resolve(response);
    await env.pending[pendingStart].deferred.promise.catch(() => {});
  });
}

async function clickButtonWithLabel(rootEl, label) {
  const buttons = [...rootEl.querySelectorAll("button")].filter((button) => button.textContent === label);
  assert.equal(buttons.length, 1, `expected exactly one "${label}" button`);
  await click(buttons[0]);
  return buttons[0];
}

function textOf(rootEl) {
  return rootEl.textContent ?? "";
}

test("searching renders catalog results with install actions", async () => {
  await withEnvironment(async () => {
    const mounted = await mountPanel();
    await searchFor(mounted, "react", { results: [SEARCH_RESULT] });
    const text = textOf(mounted.rootEl());
    assert.ok(text.includes("alpha"), "the skill name part is rendered");
    assert.ok(text.includes("owner/repo"), "the repo part is rendered");
    assert.ok(text.includes("12"), "the install count is rendered");
    assert.equal(
      [...mounted.rootEl().querySelectorAll("button")].filter((button) => button.textContent === "Install").length,
      1,
    );
    await mounted.unmount();
  });
});

test("an empty catalog response reports that no skills were found", async () => {
  await withEnvironment(async () => {
    const mounted = await mountPanel();
    await searchFor(mounted, "nothing", { results: [] });
    assert.ok(textOf(mounted.rootEl()).includes("No skills found"));
    await mounted.unmount();
  });
});

test("install success marks the package installed and notifies the parent", async () => {
  await withEnvironment(async () => {
    const mounted = await mountPanel();
    await searchFor(mounted, "react", { results: [SEARCH_RESULT] });
    await clickButtonWithLabel(mounted.rootEl(), "Install");
    assert.equal(env.pending[1].method, "skills.install");
    await act(async () => {
      env.pending[1].deferred.resolve({ ok: true });
      await env.pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(mounted.installed.count, 1);
    assert.equal(
      [...mounted.rootEl().querySelectorAll("button")].filter((button) => button.textContent === "✓ Installed").length,
      1,
      "the package shows as installed",
    );
    await mounted.unmount();
  });
});

test("a failed install surfaces the error and keeps the install action available", async () => {
  await withEnvironment(async () => {
    const mounted = await mountPanel();
    await searchFor(mounted, "react", { results: [SEARCH_RESULT] });
    await clickButtonWithLabel(mounted.rootEl(), "Install");
    await act(async () => {
      env.pending[1].deferred.reject(hostError("registry unreachable"));
      await env.pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(mounted.installed.count, 0);
    assert.ok(textOf(mounted.rootEl()).includes("registry unreachable"));
    assert.equal(
      [...mounted.rootEl().querySelectorAll("button")].filter((button) => button.textContent === "Install").length,
      1,
    );
    await mounted.unmount();
  });
});

test("a missing developer tool offers the capability repair prompt with retry and cancel", async () => {
  await withEnvironment(async () => {
    const mounted = await mountPanel();
    await searchFor(mounted, "react", { results: [SEARCH_RESULT] });
    await clickButtonWithLabel(mounted.rootEl(), "Install");
    await act(async () => {
      env.pending[1].deferred.reject(
        hostError("A required developer tool is unavailable", {
          code: "TOOLCHAIN_NODE_REQUIRED",
          capability: "js.node",
        }),
      );
      await env.pending[1].deferred.promise.catch(() => {});
    });
    const alert = mounted.rootEl().querySelector('[role="alert"]');
    assert.ok(alert, "the capability repair prompt is rendered");
    assert.equal(
      [...mounted.rootEl().querySelectorAll("button")].filter((button) => button.textContent === "✓ Installed").length,
      0,
    );

    // Continue: the pending package is installed after the tool action.
    const continueButton = [...alert.querySelectorAll("button")].find(
      (button) => button.textContent === "Install and continue",
    );
    assert.ok(continueButton, "the repair prompt offers to install and continue");
    await click(continueButton);
    const retryInstall = env.pending[env.pending.length - 1];
    assert.equal(retryInstall.method, "skills.install");
    await act(async () => {
      retryInstall.deferred.resolve({ ok: true });
      await retryInstall.deferred.promise.catch(() => {});
    });
    assert.equal(mounted.installed.count, 1, "the pending package install continued");
    assert.deepEqual(retryInstall.params.package, SEARCH_RESULT.package);

    // A second capability failure on a different package can be cancelled.
    const SECOND_RESULT = { package: "owner/repo@beta", installs: 3, url: "https://skills.sh/owner/repo" };
    await searchFor(mounted, "beta", { results: [SECOND_RESULT] });
    await clickButtonWithLabel(mounted.rootEl(), "Install");
    await act(async () => {
      const failed = env.pending[env.pending.length - 1];
      failed.deferred.reject(
        hostError("A required developer tool is unavailable", {
          code: "TOOLCHAIN_NODE_REQUIRED",
          capability: "js.node",
        }),
      );
      await failed.deferred.promise.catch(() => {});
    });
    const secondAlert = mounted.rootEl().querySelector('[role="alert"]');
    assert.ok(secondAlert, "the repair prompt appears again");
    await click([...secondAlert.querySelectorAll("button")].find((button) => button.textContent === "Cancel"));
    assert.equal(mounted.rootEl().querySelector('[role="alert"]'), null, "the cancelled prompt disappears");
    await mounted.unmount();
  });
});
