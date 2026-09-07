import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import { createManagedDomRoot, dom, reactPropsOf, restoreGlobals } from "../resource-dom-environment.mjs";
import { act, createElement } from "react";

// Root-level regression for the capability repair prompt: it renders only
// while a pending operation actually exists. After a later successful
// operation clears the pending state, an unresolved capability issue alone
// must NOT keep showing un-retryable repair actions (the original monolith
// gated the prompt on capabilityIssue && pendingCapabilityOperation).

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { PluginsConfig } = await importTestBundle("plugins-capability-prompt", {
  stdin: {
    contents: 'export { PluginsConfig } from "./src/renderer/components/PluginsConfig.tsx";',
    resolveDir: projectRoot,
    sourcefile: "plugins-capability-prompt-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "plugins-capability-prompt-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "plugins-prompt" }));
        build.onLoad({ filter: /.*/, namespace: "plugins-prompt" }, () => ({
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

function pkg(source, scope, overrides = {}) {
  return {
    source,
    scope,
    status: "loaded",
    disabled: false,
    packageName: source,
    version: "1.0.0",
    configuredVersion: "1.0.0",
    installedPath: `/home/tester/.pi/agent/${source}`,
    filtered: false,
    counts: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    resources: [{ kind: "extension", name: "ext", path: "/x", relativePath: "./x" }],
    ...overrides,
  };
}

function pluginsResponse(packagesList) {
  return {
    packages: packagesList,
    totals: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    diagnostics: [],
  };
}

let activeManaged = null;
let bridgeRestore = null;

function installBridge() {
  const bridgeDescriptor = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  bridgeRestore = () => {
    if (bridgeDescriptor) Object.defineProperty(dom.window, "piBridge", bridgeDescriptor);
    else delete dom.window.piBridge;
  };
  dom.window.piBridge = {
    platform: "darwin",
    performToolchainAction: async () => {},
    rescanToolchains: async () => {},
  };
}

let caseFetchRestore = null;

afterEach(async () => {
  const mountedContainer = activeManaged?.container ?? null;
  await activeManaged?.unmount();
  activeManaged = null;
  // The mounted tree must be disposed BEFORE any environment restoration.
  if (mountedContainer) assert.equal(mountedContainer.isConnected, false, "root disposed before restoration");
  caseFetchRestore?.();
  caseFetchRestore = null;
  bridgeRestore?.();
  bridgeRestore = null;
});

function capabilityPrompts(rootEl) {
  return [...rootEl.querySelectorAll('[role="alert"]')].filter((el) =>
    el.textContent?.includes("is required for this operation"),
  );
}

function clickableText(rootEl, text) {
  const matches = [...rootEl.querySelectorAll("*")].filter(
    (el) => el.textContent === text && typeof reactPropsOf(el).onClick === "function",
  );
  assert.ok(matches.length >= 1, `expected a clickable "${text}" element`);
  return matches[0];
}

function searchInput(rootEl) {
  return rootEl.querySelector("#plugin-source");
}

async function click(element) {
  await act(async () => {
    element.click();
  });
}

test("the repair prompt disappears once a later successful install clears the pending operation", async () => {
  const pending = [];
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  globalThis.fetch = (url, options) => {
    const deferred = createDeferred();
    deferred.url = url;
    deferred.options = options;
    pending.push(deferred);
    return deferred.promise;
  };
  // Fetch is restored by afterEach AFTER the mounted root has been disposed,
  // so the live tree never observes a restored environment.
  caseFetchRestore = () => {
    if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
    else delete globalThis.fetch;
  };
  {
    installBridge();
    const managed = createManagedDomRoot();
    activeManaged = managed;
    await managed.render(
      createElement(PluginsConfig, { cwd: "/repo", sessionId: null, onClose: () => {}, onReloaded: () => {} }),
    );

    // 1. Load an existing package and click Update; leave the request pending.
    await act(async () => {
      pending[0].resolve({ ok: true, json: async () => pluginsResponse([pkg("npm:one", "project")]) });
      await pending[0].promise;
    });
    await click(clickableText(managed.container, "Update"));
    assert.equal(pending.length, 2, "the update request is in flight");

    // 2. Open the add panel and submit an install; it runs while the update
    //    request is still pending (the add form is not disabled by it).
    await click(clickableText(managed.container, "Add plugin"));
    await act(async () => {
      reactPropsOf(searchInput(managed.container)).onChange({ target: { value: "new-package" } });
    });
    await click(clickableText(managed.container, "Install"));
    assert.equal(pending.length, 3, "the install request is in flight");

    // 3. Settle the update with a capability requirement: both versions show
    //    the repair prompt now.
    await act(async () => {
      pending[1].resolve({
        ok: false,
        json: async () => ({ code: "TOOLCHAIN_NODE_REQUIRED", capability: "js.node" }),
      });
      await pending[1].promise;
    });
    assert.equal(capabilityPrompts(managed.container).length, 1, "the repair prompt shows for the pending update");

    // 4. Settle the install successfully: it clears the pending operation, so
    //    the original UI hides the prompt even though the issue object is
    //    still set. The split root must match that behavior.
    await act(async () => {
      pending[2].resolve({
        ok: true,
        json: async () => pluginsResponse([pkg("npm:one", "project"), pkg("npm:new-package", "project")]),
      });
      await pending[2].promise;
    });
    assert.equal(capabilityPrompts(managed.container).length, 0, "no repair prompt without a pending operation");

    // With the prompt gone, its retry/cancel actions are gone too: no further
    // request can fire from the vanished prompt.
    assert.equal(pending.length, 3, "no extra request fired after the prompt disappeared");
  }
});
