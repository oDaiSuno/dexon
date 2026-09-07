import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import { createManagedDomRoot, dom, reactPropsOf, restoreGlobals } from "../resource-dom-environment.mjs";
import { act, createElement } from "react";

// Real-DOM characterization tests for the split add-skill panel: catalog
// search, empty results, install success/failure accounting, and the
// capability repair prompt that retries or cancels the pending install.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { AddSkillPanel } = await importTestBundle("skills-add-panel", {
  stdin: {
    contents: 'export { AddSkillPanel } from "./src/renderer/components/skills/add-skill-panel.tsx";',
    resolveDir: projectRoot,
    sourcefile: "add-skill-panel-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "skills-add-panel-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "skills-add-panel" }));
        build.onLoad({ filter: /.*/, namespace: "skills-add-panel" }, () => ({
          contents:
            "function stubT(_key, fallback) { return fallback; }\n" +
            'export function useI18n() { return { language: "en", t: stubT }; }',
          loader: "js",
        }));
      },
    },
  ],
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const SEARCH_RESULT = {
  package: "owner/repo@alpha",
  installs: 12,
  url: "https://skills.sh/owner/repo",
};

function installEnvironment() {
  const pending = [];
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  globalThis.fetch = (url, options) => {
    const deferred = createDeferred();
    pending.push({ url, options, deferred });
    return deferred.promise;
  };
  const bridgeDescriptor = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  dom.window.piBridge = {
    platform: "darwin",
    performToolchainAction: async () => {},
    rescanToolchains: async () => {},
  };
  return {
    pending,
    restore() {
      for (const [name, descriptor, owner] of [
        ["fetch", fetchDescriptor, globalThis],
        ["piBridge", bridgeDescriptor, dom.window],
      ]) {
        if (descriptor) Object.defineProperty(owner, name, descriptor);
        else delete owner[name];
      }
    },
  };
}

let env = null;
let activeManaged = null;

async function withEnvironment(run) {
  env = installEnvironment();
  try {
    await run();
  } finally {
    await activeManaged?.unmount();
    activeManaged = null;
    env.restore();
    env = null;
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
  await act(async () => {
    const input = mounted.input();
    input.value = query;
    reactPropsOf(input).onChange({ target: input });
  });
  await act(async () => {
    reactPropsOf(mounted.input()).onKeyDown({ key: "Enter" });
  });
  assert.equal(env.pending[pendingStart].url, "/api/skills/search");
  await act(async () => {
    env.pending[pendingStart].deferred.resolve({ json: async () => response });
    await env.pending[pendingStart].deferred.promise;
  });
}

async function clickButtonWithLabel(rootEl, label) {
  const buttons = [...rootEl.querySelectorAll("button")].filter((button) => button.textContent === label);
  assert.equal(buttons.length, 1, `expected exactly one "${label}" button`);
  await act(async () => {
    buttons[0].click();
  });
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
    assert.equal(env.pending[1].url, "/api/skills/install");
    await act(async () => {
      env.pending[1].deferred.resolve({ ok: true, json: async () => ({ success: true }) });
      await env.pending[1].deferred.promise;
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
      env.pending[1].deferred.resolve({ ok: false, json: async () => ({ error: "registry unreachable" }) });
      await env.pending[1].deferred.promise;
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
      env.pending[1].deferred.resolve({
        ok: false,
        json: async () => ({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.node" }),
      });
      await env.pending[1].deferred.promise;
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
    await act(async () => {
      continueButton.click();
    });
    const retryInstall = env.pending[env.pending.length - 1];
    assert.equal(retryInstall.url, "/api/skills/install");
    await act(async () => {
      retryInstall.deferred.resolve({ ok: true, json: async () => ({ success: true }) });
      await retryInstall.deferred.promise;
    });
    assert.equal(mounted.installed.count, 1, "the pending package install continued");
    assert.deepEqual(JSON.parse(retryInstall.options.body).package, SEARCH_RESULT.package);

    // A second capability failure on a different package can be cancelled.
    const SECOND_RESULT = { package: "owner/repo@beta", installs: 3, url: "https://skills.sh/owner/repo" };
    await searchFor(mounted, "beta", { results: [SECOND_RESULT] });
    await clickButtonWithLabel(mounted.rootEl(), "Install");
    await act(async () => {
      const failed = env.pending[env.pending.length - 1];
      failed.deferred.resolve({
        ok: false,
        json: async () => ({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.node" }),
      });
      await failed.deferred.promise;
    });
    const secondAlert = mounted.rootEl().querySelector('[role="alert"]');
    assert.ok(secondAlert, "the repair prompt appears again");
    await act(async () => {
      [...secondAlert.querySelectorAll("button")].find((button) => button.textContent === "Cancel").click();
    });
    assert.equal(mounted.rootEl().querySelector('[role="alert"]'), null, "the cancelled prompt disappears");
    await mounted.unmount();
  });
});
