import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
// The DOM environment must be evaluated before react and react-dom so their
// module-level feature detection sees a realistic browser (see dom module).
import {
  createManagedDomRoot,
  reactPropsOf,
  restoreGlobals,
  trackBeforeUnloadListeners,
} from "../resource-dom-environment.mjs";
import { act, createElement } from "react";

// Real-DOM journey tests for the split SkillsConfig composition root: the
// guarded navigation journeys — selecting, adding, and closing while dirty —
// with the four prompt outcomes (save, discard, cancel, save failure).

after(() => {
  restoreGlobals();
});

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { SkillsConfig } = await importTestBundle("skills-config-journey", {
  stdin: {
    contents: 'export { SkillsConfig } from "./src/renderer/components/SkillsConfig.tsx";',
    resolveDir: projectRoot,
    sourcefile: "skills-config-journey-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "skills-config-journey-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "skills-journey" }));
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "skills-journey" }));
        build.onLoad({ filter: /.*/, namespace: "skills-journey" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const call = (method, params) => globalThis.__skillsJourneyHarness.call(method, params);",
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
  const pending = [];
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  globalThis.fetch = (url, options) => {
    const deferred = createDeferred();
    pending.push({ url, options, deferred });
    return deferred.promise;
  };
  const getContentCalls = [];
  const getContentDeferreds = [];
  globalThis.__skillsJourneyHarness = {
    call(method, params) {
      if (method === "skills.getContent") {
        getContentCalls.push(params);
        const deferred = createDeferred();
        getContentDeferreds.push(deferred);
        return deferred.promise;
      }
      throw new Error(`unexpected api call: ${method}`);
    },
  };
  const beforeUnloadTracker = trackBeforeUnloadListeners();
  return {
    pending,
    getContentCalls,
    getContentDeferreds,
    beforeUnloadTracker,
    async restore() {
      delete globalThis.__skillsJourneyHarness;
      if (fetchDescriptor) Object.defineProperty(globalThis, "fetch", fetchDescriptor);
      else delete globalThis.fetch;
      beforeUnloadTracker.restore();
    },
  };
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
  const matches = [...rootEl.querySelectorAll("*")].filter(
    (el) => el.textContent === text && typeof reactPropsOf(el).onClick === "function",
  );
  assert.ok(matches.length >= 1, `expected a clickable "${text}" element`);
  return matches[0];
}

function textareaOf(rootEl) {
  return rootEl.querySelector("textarea");
}

async function typeIntoTextarea(rootEl, value) {
  const textarea = textareaOf(rootEl);
  await act(async () => {
    textarea.value = value;
    reactPropsOf(textarea).onChange({ target: textarea });
  });
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

async function click(element) {
  await act(async () => {
    element.click();
  });
}

async function withEnvironment(run) {
  const harness = createHarness();
  try {
    await run(harness);
  } finally {
    await activeManaged?.unmount();
    activeManaged = null;
    await harness.restore();
  }
}

async function loadTwoSkills(harness) {
  await act(async () => {
    harness.pending[0].deferred.resolve({
      ok: true,
      json: async () => ({ skills: [skill("alpha"), skill("beta")] }),
    });
    await harness.pending[0].deferred.promise;
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
    assert.equal(harness.beforeUnloadTracker.listeners.size, 1, "the window guard tracks the dirty editor");

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
    assert.equal(harness.beforeUnloadTracker.listeners.size, 0, "the new editor starts clean");
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

    // A failed save keeps the prompt and stays in the editor.
    await click(await promptButton(mounted.rootEl(), "Save"));
    const patchIndex = harness.pending.findIndex((entry) => entry.url === "/api/skills");
    await act(async () => {
      harness.pending[patchIndex].deferred.resolve({ ok: false, status: 500, json: async () => ({}) });
      await harness.pending[patchIndex].deferred.promise;
    });
    assert.ok(promptDialog(mounted.rootEl()), "a failed save keeps the prompt");
    assert.equal(textareaOf(mounted.rootEl()).value, "# Alpha edited");

    // Retrying with a successful save opens the add panel.
    await click(await promptButton(mounted.rootEl(), "Save"));
    const retryPatch = harness.pending[harness.pending.length - 1];
    assert.equal(retryPatch.url, "/api/skills");
    await act(async () => {
      retryPatch.deferred.resolve({ ok: true, json: async () => ({ success: true }) });
      await retryPatch.deferred.promise;
    });
    assert.equal(promptDialog(mounted.rootEl()), null, "the prompt is dismissed");
    assert.ok(
      [...mounted.rootEl().querySelectorAll("input")].some((input) => input.type === "search"),
      "the add-skill panel replaced the editor",
    );
    assert.equal(harness.beforeUnloadTracker.listeners.size, 0, "no dirty editor remains");
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
    await act(async () => {
      reactPropsOf(dialog).onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    });
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
