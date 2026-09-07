import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out skill detail editor: content
// loading through the api client, dirty tracking exposed through the
// imperative handle, fallible saves against the original cwd/file, and the
// disabled save button while clean.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { SkillDetail } = await importTestBundle("skills-detail", {
  stdin: {
    contents: 'export { SkillDetail } from "./src/renderer/components/skills/skill-detail.tsx";',
    resolveDir: projectRoot,
    sourcefile: "skill-detail-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "skills-detail-stubs",
      setup(build) {
        build.onResolve({ filter: /^@\/i18n$/ }, () => ({ path: "i18n", namespace: "skills-detail" }));
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "skills-detail" }));
        build.onLoad({ filter: /.*/, namespace: "skills-detail" }, ({ path: modulePath }) => ({
          contents:
            modulePath === "i18n"
              ? "function stubT(_key, fallback) { return fallback; }\n" +
                'export function useI18n() { return { language: "en", t: stubT }; }'
              : "export const call = (method, params) => globalThis.__skillDetailHarness.call(method, params);",
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

const SAMPLE_SKILL = {
  name: "alpha",
  description: "alpha description",
  filePath: "/repo/.pi/agent/skills/alpha/SKILL.md",
  baseDir: "/repo/.pi/agent/skills/alpha",
  disableModelInvocation: false,
  sourceInfo: { source: "project", scope: "project" },
};

function createHarness() {
  const calls = { getContent: [], patchBodies: [] };
  const pending = [];
  const deferredCalls = [];
  globalThis.__skillDetailHarness = {
    call(method, params) {
      calls.getContent.push({ method, params });
      const deferred = createDeferred();
      deferredCalls.push(deferred);
      return deferred.promise;
    },
  };
  const fetchImpl = (_url, options) => {
    const deferred = createDeferred();
    pending.push({ options, deferred });
    calls.patchBodies.push(String(options?.body ?? ""));
    return deferred.promise;
  };
  return { calls, pending, deferredCalls, fetchImpl };
}

const TIMED_GLOBALS = ["fetch", "window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment({ fetchImpl } = {}) {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  globalThis.fetch = fetchImpl ?? (() => Promise.reject(new Error("unexpected fetch in skill-detail test")));
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    async restore() {
      delete globalThis.__skillDetailHarness;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

function createDetailProps(overrides = {}) {
  const calls = { toggles: [], saved: 0, dirty: [] };
  const props = {
    skill: SAMPLE_SKILL,
    cwd: "/repo",
    onToggle: (target) => calls.toggles.push(target),
    toggling: false,
    saveError: null,
    onSaved: () => {
      calls.saved += 1;
    },
    onDirtyChange: (dirty) => calls.dirty.push(dirty),
    ...overrides,
  };
  return { props, calls };
}

async function mountDetail(props) {
  const ref = createRef();
  let renderer;
  await act(async () => {
    renderer = create(createElement(SkillDetail, { ...props, ref }));
  });
  return {
    ref,
    renderer,
    textarea: () => renderer.root.findByType("textarea"),
    async unmount() {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

async function withEnvironment(options, run) {
  const env = installEnvironment(options);
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}

test("loads the skill file through the api client and disables saving while clean", async () => {
  const harness = createHarness();
  await withEnvironment({ fetchImpl: harness.fetchImpl }, async () => {
    const { props } = createDetailProps();
    const mounted = await mountDetail(props);
    assert.equal(mounted.ref.current.hasUnsavedChanges(), false);
    await act(async () => {
      harness.deferredCalls[0].resolve({ content: "# Alpha\n\nBody" });
      await harness.deferredCalls[0].promise;
    });
    assert.deepEqual(harness.calls.getContent, [
      { method: "skills.getContent", params: { cwd: "/repo", filePath: SAMPLE_SKILL.filePath } },
    ]);
    const textarea = mounted.textarea();
    assert.equal(textarea.props.value, "# Alpha\n\nBody");
    const saveButton = mounted.renderer.root.findAll(
      (node) => node.type === "button" && node.props.children === "Save changes",
    );
    assert.equal(saveButton.length, 1);
    assert.equal(saveButton[0].props.disabled, true);
    await mounted.unmount();
  });
});

test("editing marks the editor dirty through the imperative handle and callback", async () => {
  const harness = createHarness();
  await withEnvironment({ fetchImpl: harness.fetchImpl }, async () => {
    const { props, calls } = createDetailProps();
    const mounted = await mountDetail(props);
    await act(async () => {
      harness.deferredCalls[0].resolve({ content: "# Alpha" });
      await harness.deferredCalls[0].promise;
    });
    await act(async () => {
      mounted.textarea().props.onChange({ target: { value: "# Alpha edited" } });
    });
    assert.equal(mounted.ref.current.hasUnsavedChanges(), true);
    assert.equal(calls.dirty[calls.dirty.length - 1], true);
    const saveButton = mounted.renderer.root.findAll(
      (node) => node.type === "button" && node.props.children === "Save changes",
    );
    assert.equal(saveButton[0].props.disabled, false);
    await mounted.unmount();
    // Unmount reports the dirty flag as cleared.
    assert.equal(calls.dirty[calls.dirty.length - 1], false);
  });
});

test("saving writes the edited content to the original cwd and file, then reports success", async () => {
  const harness = createHarness();
  await withEnvironment({ fetchImpl: harness.fetchImpl }, async () => {
    const { props, calls } = createDetailProps();
    const mounted = await mountDetail(props);
    await act(async () => {
      harness.deferredCalls[0].resolve({ content: "# Alpha" });
      await harness.deferredCalls[0].promise;
    });
    await act(async () => {
      mounted.textarea().props.onChange({ target: { value: "# Alpha v2" } });
    });
    let saved;
    await act(async () => {
      saved = mounted.ref.current.save();
    });
    assert.equal(harness.pending.length, 1);
    await act(async () => {
      harness.pending[0].deferred.resolve({ ok: true, json: async () => ({ success: true }) });
      saved = await saved;
    });
    assert.equal(saved, true);
    assert.deepEqual(JSON.parse(harness.calls.patchBodies[0]), {
      cwd: "/repo",
      filePath: SAMPLE_SKILL.filePath,
      content: "# Alpha v2",
    });
    assert.equal(calls.saved, 1);
    assert.equal(mounted.ref.current.hasUnsavedChanges(), false);
    assert.equal(mounted.textarea().props.value, "# Alpha v2");
    await mounted.unmount();
  });
});

test("a failed save keeps the edited content and the dirty flag, and reports failure", async () => {
  const harness = createHarness();
  await withEnvironment({ fetchImpl: harness.fetchImpl }, async () => {
    const { props, calls } = createDetailProps();
    const mounted = await mountDetail(props);
    await act(async () => {
      harness.deferredCalls[0].resolve({ content: "# Alpha" });
      await harness.deferredCalls[0].promise;
    });
    await act(async () => {
      mounted.textarea().props.onChange({ target: { value: "# Alpha v2" } });
    });
    let saved;
    await act(async () => {
      saved = mounted.ref.current.save();
    });
    await act(async () => {
      harness.pending[0].deferred.resolve({ ok: false, status: 500, json: async () => ({}) });
      saved = await saved;
    });
    assert.equal(saved, false);
    assert.equal(calls.saved, 0);
    assert.equal(mounted.ref.current.hasUnsavedChanges(), true);
    assert.equal(mounted.textarea().props.value, "# Alpha v2");
    const errorText = mounted.renderer.root.findAll(
      (node) => typeof node.props?.children === "string" && node.props.children === "HTTP 500",
    );
    assert.ok(errorText.length >= 1, "the save error is displayed");
    await mounted.unmount();
  });
});

test("saving an unchanged editor returns true without issuing a request", async () => {
  const harness = createHarness();
  await withEnvironment({ fetchImpl: harness.fetchImpl }, async () => {
    const { props } = createDetailProps();
    const mounted = await mountDetail(props);
    await act(async () => {
      harness.deferredCalls[0].resolve({ content: "# Alpha" });
      await harness.deferredCalls[0].promise;
    });
    let saved;
    await act(async () => {
      saved = await mounted.ref.current.save();
    });
    assert.equal(saved, true);
    assert.equal(harness.pending.length, 0);
    await mounted.unmount();
  });
});
