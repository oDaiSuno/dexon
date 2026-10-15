import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after, afterEach } from "node:test";
import { createManagedDomRoot, dom, restoreGlobals } from "../resource-dom-environment.mjs";
import { click, selectOption, labelledControl } from "../../../../tests/support/dom-events.mjs";
import { act, createElement } from "react";

// Behavioral characterization for the extracted General settings content:
// background-mode and managed-process toggles (load failures surface a
// visible error; save failures roll back), and the chat appearance error
// path. The component and its application dependencies are loaded unchanged.

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
  ...realRendererGraphOptions(projectRoot),
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
      chatAppearanceSaving: overrides.chatAppearanceSaving ?? false,
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
  try {
    await activeManaged?.unmount();
  } finally {
    activeManaged = null;
    caseRestore?.();
    caseRestore = null;
  }
});

const managedControl = (root) => labelledControl(root, "Enable managed background processes");
const backgroundControl = (root) => labelledControl(root, "Close window to tray");

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
  assert.equal(managedControl(mounted.rootEl()).checked, true);
  assert.equal(backgroundControl(mounted.rootEl()).checked, true);
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
  assert.equal(
    managedControl(mounted.rootEl()).checked,
    false,
    "managed processes remains disabled after a load failure",
  );
  assert.equal(
    backgroundControl(mounted.rootEl()).checked,
    true,
    "background mode keeps its default after a load failure",
  );
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
  const backgroundBox = backgroundControl(mounted.rootEl());
  await click(backgroundBox);
  assert.deepEqual(bridge.calls.setUiState, [{ backgroundMode: false }]);
  assert.equal(backgroundControl(mounted.rootEl()).checked, true, "the previous setting was restored");
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
  const managedBox = managedControl(mounted.rootEl());
  await click(managedBox);
  assert.deepEqual(bridge.calls.setUiState, [{ managedProcessesEnabled: false }]);
  assert.equal(managedControl(mounted.rootEl()).checked, true, "the previous setting was restored");
  assert.ok(
    alerts(mounted.rootEl()).some((text) => text.includes("Managed process settings could not be saved")),
    "the save failure alert is visible",
  );
  await mounted.unmount();
});

test("chat appearance controls stay disabled while a save is in flight", async () => {
  const bridge = installBridge();
  const saving = await renderGeneral({ chatAppearanceSaving: true });
  await settleMount(saving, bridge);
  for (const name of ["Chat text size", "Conversation width"]) {
    assert.equal(labelledControl(saving.rootEl(), name).disabled, true, `${name} waits for saving`);
  }
  for (const name of ["Language", "Theme"]) {
    assert.equal(labelledControl(saving.rootEl(), name).disabled, false, `${name} stays interactive`);
  }
  await saving.unmount();
  activeManaged = null;

  const idle = await renderGeneral({});
  const idleSelects = [...idle.rootEl().querySelectorAll("select")];
  assert.ok(!idleSelects.some((select) => select.disabled), "all controls return once the save settles");
  await idle.unmount();
  activeManaged = null;
});

test("a chat appearance save failure surfaces the alert", async () => {
  const bridge = installBridge();
  const mounted = await renderGeneral({ failAppearance: true });
  await settleMount(mounted, bridge);
  const fontSizeSelect = labelledControl(mounted.rootEl(), "Chat text size");
  await selectOption(fontSizeSelect, "large");
  assert.equal(mounted.appearanceSaves.length, 1);
  assert.deepEqual(mounted.appearanceSaves[0], { fontSize: "large", layout: "fixed" });
  assert.ok(
    alerts(mounted.rootEl()).some((text) => text.includes("Chat appearance could not be saved")),
    "the appearance failure alert is visible",
  );
  await mounted.unmount();
});

for (const ready of [false, true]) {
  test(`managed processes on Windows ${ready ? "are available when Main is ready" : "stay unavailable when Main is not ready"}`, async () => {
    const bridge = installBridge();
    dom.window.piBridge.platform = "win32";
    const mounted = await renderGeneral();
    await act(async () => {
      bridge.getUiState.resolve({ managedProcessesEnabled: false });
      bridge.getCapability.resolve({ ready, backend: "windows-job" });
    });
    const control = managedControl(mounted.rootEl());
    assert.equal(control.checked, false, "the feature remains opt-in");
    assert.equal(control.disabled, !ready);
    assert.match(mounted.rootEl().textContent, /not a sandbox/);
  });
}

test("chat appearance offers the supported choices through named controls", async () => {
  const bridge = installBridge();
  const mounted = await renderGeneral();
  await settleMount(mounted, bridge);
  const font = labelledControl(mounted.rootEl(), "Chat text size");
  const width = labelledControl(mounted.rootEl(), "Conversation width");
  const options = (control) => [...control.options].map((option) => [option.value, option.textContent]);
  assert.deepEqual(options(font), [
    ["small", "Small"],
    ["standard", "Standard"],
    ["large", "Large"],
    ["extra-large", "Extra large"],
  ]);
  assert.deepEqual(options(width), [
    ["fixed", "Comfortable width"],
    ["wide", "Expanded width"],
  ]);
  await selectOption(width, "wide");
  assert.deepEqual(mounted.appearanceSaves.at(-1), { fontSize: "standard", layout: "wide" });
});
