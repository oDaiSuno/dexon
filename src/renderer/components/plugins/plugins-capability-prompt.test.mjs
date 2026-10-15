import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { createDeferredHost, hostError } from "../../../../tests/support/deferred-host.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import { createManagedDomRoot, dom, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, input, labelledControl, text as pageText } from "../../../../tests/support/dom-events.mjs";
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

const { PluginsConfig, resetRpc, installApiShims } = await importTestBundle("plugins-capability-prompt", {
  stdin: {
    contents:
      'export { PluginsConfig } from "./src/renderer/components/PluginsConfig.tsx"; export {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "plugins-capability-prompt-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

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
let caseApi = null;

afterEach(async () => {
  const mountedContainer = activeManaged?.container ?? null;
  try {
    await activeManaged?.unmount();
    if (mountedContainer) assert.equal(mountedContainer.isConnected, false, "root disposed before restoration");
  } finally {
    activeManaged = null;
    caseApi?.close();
    caseApi = null;
  }
});

function capabilityPrompts(rootEl) {
  return [...rootEl.querySelectorAll('[role="alert"]')].filter((el) =>
    el.textContent?.includes("is required for this operation"),
  );
}

function clickableText(rootEl, text) {
  const element = pageText(rootEl, text);
  assert.ok(element, `expected the visible text "${text}"`);
  return element;
}

function searchInput(rootEl) {
  return labelledControl(rootEl, "Source");
}

test("the repair prompt disappears once a later successful install clears the pending operation", async () => {
  const replies = createDeferredHost(["plugins.list", "plugins.set"]);
  const pending = replies.pending;
  caseApi = installRendererApi(dom.window, { installApiShims, resetRpc }, () => replies, {
    bridge: {
      platform: "darwin",
      performToolchainAction: async () => {},
      rescanToolchains: async () => {},
    },
  });
  {
    const managed = createManagedDomRoot();
    activeManaged = managed;
    await managed.render(
      createElement(PluginsConfig, { cwd: "/repo", sessionId: null, onClose: () => {}, onReloaded: () => {} }),
    );

    // 1. Load an existing package and click Update; leave the request pending.
    await act(async () => {
      pending[0].deferred.resolve(pluginsResponse([pkg("npm:one", "project")]));
      await pending[0].deferred.promise.catch(() => {});
    });
    await click(clickableText(managed.container, "Update"));
    assert.equal(pending.length, 2, "the update request is in flight");

    // 2. Open the add panel and submit an install; it runs while the update
    //    request is still pending (the add form is not disabled by it).
    await click(clickableText(managed.container, "Add plugin"));
    await input(searchInput(managed.container), "new-package");
    await click(clickableText(managed.container, "Install"));
    assert.equal(pending.length, 3, "the install request is in flight");

    // 3. Settle the update with a capability requirement: both versions show
    //    the repair prompt now.
    await act(async () => {
      pending[1].deferred.reject(
        hostError("A required developer tool is unavailable", {
          code: "TOOLCHAIN_NODE_REQUIRED",
          capability: "js.node",
        }),
      );
      await pending[1].deferred.promise.catch(() => {});
    });
    assert.equal(capabilityPrompts(managed.container).length, 1, "the repair prompt shows for the pending update");

    // 4. Settle the install successfully: it clears the pending operation, so
    //    the original UI hides the prompt even though the issue object is
    //    still set. The split root must match that behavior.
    await act(async () => {
      pending[2].deferred.resolve(pluginsResponse([pkg("npm:one", "project"), pkg("npm:new-package", "project")]));
      await pending[2].deferred.promise.catch(() => {});
    });
    assert.equal(capabilityPrompts(managed.container).length, 0, "no repair prompt without a pending operation");

    // With the prompt gone, its retry/cancel actions are gone too: no further
    // request can fire from the vanished prompt.
    assert.equal(pending.length, 3, "no extra request fired after the prompt disappeared");
  }
});
