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
import { click, input, keyDown, text as pageText } from "../../../../tests/support/dom-events.mjs";
import { act, createElement } from "react";

// Real-DOM journey tests for the split SkillsConfig composition root: the
// guarded navigation journeys — selecting, adding, and closing while dirty —
// with the four prompt outcomes (save, discard, cancel, save failure).

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, installApiShims, SkillsConfig } = await importTestBundle("skills-config-journey", {
  stdin: {
    contents:
      'export { SkillsConfig } from "./src/renderer/components/SkillsConfig.tsx";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts";',
    resolveDir: projectRoot,
    sourcefile: "skills-config-journey-test-entry.tsx",
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

function skill(name, overrides = {}) {
  return {
    name,
    description: `${name} description`,
    filePath: `/repo/.pi/agent/skills/${name}/SKILL.md`,
    baseDir: `/repo/.pi/agent/skills/${name}`,
    disableModelInvocation: false,
    sourceInfo: { source: "project", scope: "project" },
    ...overrides,
  };
}

function createHarness() {
  const deferredHost = createDeferredHost(["skills.list", "skills.set"]);
  const pending = deferredHost.pending;
  const getContentCalls = [];
  const getContentDeferreds = [];
  const replies = {
    call(method, params) {
      if (method === "skills.getContent") {
        getContentCalls.push(params);
        const deferred = createDeferred();
        getContentDeferreds.push(deferred);
        return deferred.promise;
      }
      return deferredHost.call(method, params);
    },
  };
  const hostBoundary = installRendererApi(dom.window, { installApiShims, resetRpc }, () => replies);
  return { pending, getContentCalls, getContentDeferreds, restore: hostBoundary.close };
}

let activeManaged = null;

async function renderSkills(overrides = {}) {
  const onCloseCalls = { count: 0 };
  const managed = createManagedDomRoot();
  activeManaged = managed;
  await managed.render(
    createElement(SkillsConfig, {
      cwd: "/repo",
      embedded: false,
      onClose: overrides.onClose ?? (() => (onCloseCalls.count += 1)),
    }),
  );
  return {
    onCloseCalls,
    rootEl: () => managed.container,
    unmount: () => managed.unmount(),
  };
}

function clickableText(rootEl, text) {
  const element = pageText(rootEl, text);
  assert.ok(element, `expected the visible text "${text}"`);
  return element;
}

function unloadPrevented() {
  const event = new dom.window.Event("beforeunload", { cancelable: true });
  dom.window.dispatchEvent(event);
  return event.defaultPrevented;
}

function textareaOf(rootEl) {
  return rootEl.querySelector("textarea");
}

async function typeIntoTextarea(rootEl, value) {
  await input(textareaOf(rootEl), value);
}

function promptDialog(rootEl) {
  return rootEl.querySelector('[role="dialog"]');
}

async function promptButton(rootEl, label) {
  const dialog = promptDialog(rootEl);
  assert.ok(dialog, "the unsaved-changes prompt is open");
  const buttons = [...dialog.querySelectorAll("button")].filter((button) => button.textContent === label);
  assert.equal(buttons.length, 1, `expected exactly one "${label}" button in the prompt`);
  return buttons[0];
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

async function loadTwoSkills(harness) {
  await act(async () => {
    harness.pending[0].deferred.resolve({ skills: [skill("alpha"), skill("beta")] });
    await harness.pending[0].deferred.promise.catch(() => {});
  });
}

async function openEditor(harness, mounted) {
  await click(clickableText(mounted.rootEl(), "alpha"));
  assert.equal(harness.getContentCalls.length, 1);
  await act(async () => {
    harness.getContentDeferreds[0].resolve({ content: "# Alpha" });
    await harness.getContentDeferreds[0].promise;
  });
  assert.equal(textareaOf(mounted.rootEl()).value, "# Alpha");
}

test("an editor switch with unsaved changes is held by the prompt; cancel keeps the current skill", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);
    await typeIntoTextarea(mounted.rootEl(), "# Alpha edited");
    assert.equal(unloadPrevented(), true, "a dirty editor prevents losing changes on window close");

    await click(clickableText(mounted.rootEl(), "beta"));
    assert.equal(harness.getContentCalls.length, 1, "no detail switch happened before the prompt resolves");
    assert.ok(promptDialog(mounted.rootEl()), "the unsaved-changes prompt is shown");

    await click(await promptButton(mounted.rootEl(), "Cancel"));
    assert.equal(promptDialog(mounted.rootEl()), null, "the prompt is dismissed");
    assert.equal(textareaOf(mounted.rootEl()).value, "# Alpha edited");
    assert.equal(harness.getContentCalls.length, 1, "the editor stays on the original skill");
    await mounted.unmount();
  });
});

test("discarding switches to the requested skill and clears the dirty flag", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);
    await typeIntoTextarea(mounted.rootEl(), "# Alpha edited");

    await click(clickableText(mounted.rootEl(), "beta"));
    await click(await promptButton(mounted.rootEl(), "Discard"));
    assert.equal(promptDialog(mounted.rootEl()), null, "the prompt is dismissed");
    assert.equal(harness.getContentCalls[1]?.filePath, "/repo/.pi/agent/skills/beta/SKILL.md");
    assert.equal(unloadPrevented(), false, "the new editor starts clean");
    await mounted.unmount();
  });
});

test("saving from the add-skill prompt continues only after the save succeeds", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);
    await typeIntoTextarea(mounted.rootEl(), "# Alpha edited");

    await click(clickableText(mounted.rootEl(), "Add skill"));
    assert.ok(promptDialog(mounted.rootEl()), "the add-skill transition is held by the prompt");

    // A failed save closes the prompt and stays in the editor.
    await click(await promptButton(mounted.rootEl(), "Save"));
    const patchIndex = harness.pending.findIndex((entry) => entry.method === "skills.set");
    await act(async () => {
      harness.pending[patchIndex].deferred.reject(hostError("Disk full"));
      await harness.pending[patchIndex].deferred.promise.catch(() => {});
    });
    assert.equal(promptDialog(mounted.rootEl()), null, "a failed save closes the prompt");
    assert.equal(textareaOf(mounted.rootEl()).value, "# Alpha edited");

    // Asking again and saving successfully opens the add panel.
    await click(clickableText(mounted.rootEl(), "Add skill"));
    await click(await promptButton(mounted.rootEl(), "Save"));
    const retryPatch = harness.pending[harness.pending.length - 1];
    assert.equal(retryPatch.method, "skills.set");
    await act(async () => {
      retryPatch.deferred.resolve({ ok: true });
      await retryPatch.deferred.promise.catch(() => {});
    });
    assert.equal(promptDialog(mounted.rootEl()), null, "the prompt is dismissed");
    assert.ok(
      [...mounted.rootEl().querySelectorAll("input")].some((input) => input.type === "search"),
      "the add-skill panel replaced the editor",
    );
    assert.equal(unloadPrevented(), false, "no dirty editor remains");
    await mounted.unmount();
  });
});

test("closing the dialog with unsaved changes is held; discard closes, cancel keeps it open", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);
    await typeIntoTextarea(mounted.rootEl(), "# Alpha edited");

    await click(clickableText(mounted.rootEl(), "Close"));
    assert.ok(promptDialog(mounted.rootEl()), "the close transition is held by the prompt");
    assert.equal(mounted.onCloseCalls.count, 0);

    await click(await promptButton(mounted.rootEl(), "Cancel"));
    assert.equal(promptDialog(mounted.rootEl()), null);
    assert.equal(mounted.onCloseCalls.count, 0, "cancel keeps the dialog open");

    await click(clickableText(mounted.rootEl(), "Close"));
    await click(await promptButton(mounted.rootEl(), "Discard"));
    assert.equal(mounted.onCloseCalls.count, 1, "discard continues the close");
    await mounted.unmount();
  });
});

test("escape inside the prompt cancels the held transition", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);
    await typeIntoTextarea(mounted.rootEl(), "# Alpha edited");

    await click(clickableText(mounted.rootEl(), "Close"));
    const dialog = promptDialog(mounted.rootEl());
    assert.ok(dialog, "the prompt is open");
    await keyDown(
      [...dialog.querySelectorAll("button")].find((control) => control.textContent === "Cancel"),
      "Escape",
    );
    assert.equal(promptDialog(mounted.rootEl()), null, "escape dismisses the prompt");
    assert.equal(mounted.onCloseCalls.count, 0);
    await mounted.unmount();
  });
});

test("a clean close and a clean skill switch run immediately without a prompt", async () => {
  await withEnvironment(async (harness) => {
    const mounted = await renderSkills();
    await loadTwoSkills(harness);
    await openEditor(harness, mounted);

    await click(clickableText(mounted.rootEl(), "Close"));
    assert.equal(mounted.onCloseCalls.count, 1, "clean close needs no prompt");

    await click(clickableText(mounted.rootEl(), "beta"));
    assert.equal(harness.getContentCalls[1]?.filePath, "/repo/.pi/agent/skills/beta/SKILL.md");
    assert.equal(harness.getContentCalls.length, 2);
    await mounted.unmount();
  });
});
