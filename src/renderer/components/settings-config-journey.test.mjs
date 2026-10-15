import { realRendererGraphOptions } from "./renderer-real-graph.mjs";
import { installRendererApi } from "../../../tests/support/renderer-api.mjs";
import { createDeferredHost } from "../../../tests/support/deferred-host.mjs";
import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import { createManagedDomRoot, dom, restoreGlobals } from "./resource-dom-environment.mjs";
import { byRole, click, input, keyDown, text as pageText } from "../../../tests/support/dom-events.mjs";
import { act, createElement } from "react";

// Real-DOM journey tests for the Settings composition root: every way out of
// the Skills tab — Escape, the close button, and tab switching — must go
// through the unsaved-changes guard instead of dropping a dirty editor.

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../..");

const { resetRpc, installApiShims, SettingsConfig } = await importTestBundle("settings-config-journey", {
  stdin: {
    contents:
      'export { SettingsConfig } from "./src/renderer/components/SettingsConfig.tsx";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "settings-config-journey-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*", "@rc-component/qrcode"],
  ...realRendererGraphOptions(projectRoot),
});

function createDeferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

function skill(name) {
  return {
    name,
    description: `${name} description`,
    filePath: `/repo/.pi/agent/skills/${name}/SKILL.md`,
    baseDir: `/repo/.pi/agent/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo: { source: "project", scope: "project" },
  };
}

let activeManaged = null;

function createHarness() {
  const deferredHost = createDeferredHost(["skills.list", "skills.set"]);
  const pending = deferredHost.pending;
  const getContentDeferreds = [];
  // The About tab mounts the update card, which subscribes to update state.
  // Provide exactly those two bridge methods; the never-resolving state query
  // keeps the card in its initial render without assuming its payload shape.
  const bridge = {
    onUpdateState: () => () => {},
    getUpdateState: () => new Promise(() => {}),
  };
  const replies = {
    call(method, params) {
      if (method === "skills.getContent") {
        const deferred = createDeferred();
        getContentDeferreds.push(deferred);
        return deferred.promise;
      }
      return deferredHost.call(method, params);
    },
  };
  const hostBoundary = installRendererApi(dom.window, { installApiShims, resetRpc }, () => replies, { bridge });
  return { pending, getContentDeferreds, restore: hostBoundary.close };
}

async function renderSettings() {
  const onCloseCalls = { count: 0 };
  const managed = createManagedDomRoot();
  activeManaged = managed;
  await managed.render(
    createElement(SettingsConfig, {
      cwd: "/repo",
      sessionId: "s1",
      initialTab: "skills",
      onClose: () => {
        onCloseCalls.count += 1;
      },
      onModelsChanged() {},
      onPluginsReloaded() {},
      onChannelsChanged() {},
      chatAppearance: { fontSize: "standard", layout: "fixed" },
      chatAppearanceSaving: false,
      onChatAppearanceChange: async () => {},
    }),
  );
  return {
    onCloseCalls,
    rootEl: () => managed.container,
    unmount: () => managed.unmount(),
  };
}

async function withEnvironment(run) {
  const harness = createHarness();
  try {
    await run(harness);
  } finally {
    try {
      await activeManaged?.unmount();
    } finally {
      activeManaged = null;
      await harness.restore();
    }
  }
}

function settingsDialog(rootEl) {
  const dialog = [...rootEl.querySelectorAll('[role="dialog"]')].find(
    (el) => el.getAttribute("aria-label") === "Settings",
  );
  assert.ok(dialog, "the settings dialog is open");
  return dialog;
}

function leavePrompt(rootEl) {
  const prompt = byRole(rootEl, "dialog", "Unsaved skill changes");
  assert.ok(prompt, "the unsaved-changes prompt is open");
  return prompt;
}

function promptButton(prompt, label) {
  const buttons = [...prompt.querySelectorAll("button")].filter((button) => button.textContent === label);
  assert.equal(buttons.length, 1, `expected exactly one "${label}" button in the prompt`);
  return buttons[0];
}

function clickableText(rootEl, text) {
  const element = pageText(rootEl, text);
  assert.ok(element, `expected the visible text "${text}"`);
  return element;
}

function closeButton(rootEl) {
  const buttons = [...rootEl.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === "Close",
  );
  assert.equal(buttons.length, 1, "expected exactly one settings close button");
  return buttons[0];
}

function textareaOf(rootEl) {
  return rootEl.querySelector("textarea");
}

async function openDirtyEditor(harness, mounted) {
  await act(async () => {
    harness.pending[0].deferred.resolve({ skills: [skill("alpha"), skill("beta")] });
    await harness.pending[0].deferred.promise.catch(() => {});
  });
  await click(clickableText(mounted.rootEl(), "alpha"));
  await act(async () => {
    harness.getContentDeferreds[0].resolve({ content: "# Alpha" });
    await harness.getContentDeferreds[0].promise;
  });
  const textarea = textareaOf(mounted.rootEl());
  assert.ok(textarea, "the skill editor is open");
  await input(textarea, "# Edited");
}

test("Escape in settings with a dirty skills editor is held; cancel keeps the dialog open", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSettings();
    await openDirtyEditor(harness, mounted);

    await keyDown(textareaOf(mounted.rootEl()), "Escape");
    assert.ok(leavePrompt(mounted.rootEl()), "Escape opens the unsaved-changes prompt");
    assert.equal(mounted.onCloseCalls.count, 0, "Escape did not close settings behind the guard");

    await click(promptButton(leavePrompt(mounted.rootEl()), "Cancel"));
    assert.ok(settingsDialog(mounted.rootEl()), "cancel keeps settings open");
    assert.ok(textareaOf(mounted.rootEl()), "cancel keeps the skills editor open");
    assert.equal(mounted.onCloseCalls.count, 0);
  });
});

test("switching tabs with a dirty skills editor is held; discard switches away", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSettings();
    await openDirtyEditor(harness, mounted);

    await click(clickableText(mounted.rootEl(), "About"));
    assert.ok(leavePrompt(mounted.rootEl()), "the tab switch opens the unsaved-changes prompt");
    assert.ok(textareaOf(mounted.rootEl()), "the skills editor is still mounted");

    await click(promptButton(leavePrompt(mounted.rootEl()), "Discard"));
    assert.equal(textareaOf(mounted.rootEl()), null, "discarding performs the held tab switch");
    assert.equal(mounted.onCloseCalls.count, 0, "a tab switch never closes settings");
  });
});

test("closing settings with a dirty skills editor is held; discard closes the dialog", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSettings();
    await openDirtyEditor(harness, mounted);

    await click(closeButton(mounted.rootEl()));
    assert.ok(leavePrompt(mounted.rootEl()), "the close request opens the unsaved-changes prompt");
    assert.equal(mounted.onCloseCalls.count, 0, "close is held behind the guard");

    await click(promptButton(leavePrompt(mounted.rootEl()), "Discard"));
    assert.equal(mounted.onCloseCalls.count, 1, "discard continues the held close");
  });
});
