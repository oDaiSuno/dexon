import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { createManagedDomRoot, dom, reactPropsOf, restoreGlobals } from "../resource-dom-environment.mjs";
import { act, createElement } from "react";

// Behavioral characterization for the extracted General settings content:
// background-mode and managed-process toggles (load failures surface a
// visible error; save failures roll back), and the chat appearance error
// path. Complements the source-level contract tests that move with the
// extraction.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { GeneralSettings } = await importTestBundle("settings-general", {
  stdin: {
    contents: 'export { GeneralSettings } from "./src/renderer/components/settings/general-settings.tsx";',
    resolveDir: projectRoot,
    sourcefile: "general-settings-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "settings-general-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "settings-general" }));
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "settings-general" }));
        build.onLoad({ filter: /.*/, namespace: "settings-general" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const call = async () => { throw new Error('unexpected api call in test'); };",
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

let caseRestore = null;

function installBridge(overrides = {}) {
  const calls = { setUiState: [], appearanceSaves: [] };
  const bridgeDescriptor = Object.getOwnPropertyDescriptor(dom.window, "piBridge");
  caseRestore = () => {
    if (bridgeDescriptor) Object.defineProperty(dom.window, "piBridge", bridgeDescriptor);
    else delete dom.window.piBridge;
  };
  const getUiState = createDeferred();
  const getCapability = createDeferred();
  dom.window.piBridge = {
    getUiState: () => getUiState.promise,
    getManagedProcessCapability: () => getCapability.promise,
    setUiState: async (patch) => {
      calls.setUiState.push(patch);
      if (overrides.failUiState && patch[Object.keys(patch)[0]] !== undefined) {
        throw new Error("persist failed");
      }
      return patch;
    },
  };
  return { calls, getUiState, getCapability, ...overrides };
}

async function renderGeneral(overrides = {}) {
  const appearanceSaves = [];
  const managed = createManagedDomRoot();
  activeManaged = managed;
  await managed.render(
    createElement(GeneralSettings, {
      language: "en-US",
      onLanguageChange: () => {},
      isDark: false,
      onThemeChange: () => {},
      chatAppearance: { fontSize: "standard", layout: "fixed" },
      chatAppearanceSaving: false,
      onChatAppearanceChange: async (next) => {
        appearanceSaves.push(next);
        if (overrides.failAppearance) throw new Error("appearance persist failed");
      },
    }),
  );
  return {
    appearanceSaves,
    rootEl: () => managed.container,
    unmount: () => managed.unmount(),
  };
}

let activeManaged = null;

// Every test renders one root and unmounts it at the end; this guard removes
// a still-mounted root even when an assertion fails mid-test, and restores
// the exact pre-test bridge descriptor.
afterEach(async () => {
  await activeManaged?.unmount();
  activeManaged = null;
  caseRestore?.();
  caseRestore = null;
});

function checkboxes(rootEl) {
  return [...rootEl.querySelectorAll('input[type="checkbox"]')];
}

function alerts(rootEl) {
  return [...rootEl.querySelectorAll('[role="alert"]')].map((el) => el.textContent);
}

async function settleMount(mounted, bridge) {
  await act(async () => {
    bridge.getUiState.resolve({ backgroundMode: true, managedProcessesEnabled: true });
    bridge.getCapability.resolve({ ready: true, backend: "test" });
    await bridge.getUiState.promise;
    await bridge.getCapability.promise;
  });
  return mounted;
}

test("loaded ui state populates both toggles", async () => {
  const bridge = installBridge();
  const mounted = await renderGeneral();
  await settleMount(mounted, bridge);
  const boxes = checkboxes(mounted.rootEl());
  assert.equal(boxes.length, 3, "managed processes, background mode, and auto-title checkboxes render");
  assert.equal(boxes[0].checked, true, "managed processes reflects the loaded state");
  assert.equal(boxes[1].checked, true, "background mode reflects the loaded state");
  await mounted.unmount();
});

test("a ui-state load failure leaves a visible error and defaults stay selected", async () => {
  const bridge = installBridge();
  const mounted = await renderGeneral();
  await act(async () => {
    bridge.getUiState.reject(new Error("bridge unavailable"));
    bridge.getCapability.resolve({ ready: true, backend: "test" });
    await bridge.getUiState.promise.catch(() => {});
    await bridge.getCapability.promise;
  });
  const boxes = checkboxes(mounted.rootEl());
  assert.equal(boxes[0].checked, false, "managed processes remains disabled after a load failure");
  assert.equal(boxes[1].checked, true, "background mode keeps its default after a load failure");
  const messages = alerts(mounted.rootEl());
  assert.ok(
    messages.some((text) => text.includes("Managed process settings could not be loaded")),
    "the managed-process load error is visible",
  );
  assert.ok(
    messages.some((text) => text.includes("Background mode could not be loaded")),
    "the background-mode load error is visible",
  );
  await mounted.unmount();
});

test("a background-mode save failure rolls back the checkbox and reports the failure", async () => {
  const bridge = installBridge({ failUiState: true });
  const mounted = await renderGeneral();
  await settleMount(mounted, bridge);
  const backgroundBox = checkboxes(mounted.rootEl())[1];
  await act(async () => {
    backgroundBox.checked = false;
    reactPropsOf(backgroundBox).onChange({ target: { checked: false } });
  });
  assert.deepEqual(bridge.calls.setUiState, [{ backgroundMode: false }]);
  const boxes = checkboxes(mounted.rootEl());
  assert.equal(boxes[1].checked, true, "the previous setting was restored");
  assert.ok(
    alerts(mounted.rootEl()).some((text) => text.includes("Background mode could not be saved")),
    "the save failure alert is visible",
  );
  await mounted.unmount();
});

test("a managed-process save failure rolls back and reports the failure", async () => {
  const bridge = installBridge({ failUiState: true });
  const mounted = await renderGeneral();
  await settleMount(mounted, bridge);
  const managedBox = checkboxes(mounted.rootEl())[0];
  await act(async () => {
    managedBox.checked = false;
    reactPropsOf(managedBox).onChange({ target: { checked: false } });
  });
  assert.deepEqual(bridge.calls.setUiState, [{ managedProcessesEnabled: false }]);
  assert.equal(checkboxes(mounted.rootEl())[0].checked, true, "the previous setting was restored");
  assert.ok(
    alerts(mounted.rootEl()).some((text) => text.includes("Managed process settings could not be saved")),
    "the save failure alert is visible",
  );
  await mounted.unmount();
});

test("a chat appearance save failure surfaces the alert", async () => {
  const bridge = installBridge();
  const mounted = await renderGeneral({ failAppearance: true });
  await settleMount(mounted, bridge);
  const selects = [...mounted.rootEl().querySelectorAll("select")];
  assert.equal(selects.length, 4, "language, chat text size, conversation width, and theme selects render");
  const fontSizeSelect = selects[1];
  await act(async () => {
    fontSizeSelect.value = "large";
    reactPropsOf(fontSizeSelect).onChange({ target: { value: "large" } });
  });
  assert.equal(mounted.appearanceSaves.length, 1);
  assert.deepEqual(mounted.appearanceSaves[0], { fontSize: "large", layout: "fixed" });
  assert.ok(
    alerts(mounted.rootEl()).some((text) => text.includes("Chat appearance could not be saved")),
    "the appearance failure alert is visible",
  );
  await mounted.unmount();
});
