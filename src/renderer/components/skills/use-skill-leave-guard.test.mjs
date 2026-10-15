import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createElement, createRef } from "react";
import { act, create } from "react-test-renderer";

// Characterization tests for the split-out skill leave-guard owner: the
// requestTransition gate, the four guarded outcomes (save/discard/cancel/
// save-failure), the dirty fallback while the detail ref is detached, and
// the beforeunload window guard lifecycle.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useSkillLeaveGuard } = await importTestBundle("skills-leave-guard", {
  stdin: {
    contents: 'export { useSkillLeaveGuard } from "./src/renderer/components/skills/use-skill-leave-guard.ts";',
    resolveDir: projectRoot,
    sourcefile: "skill-leave-guard-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
});

const TIMED_GLOBALS = ["window", "IS_REACT_ACT_ENVIRONMENT"];

function installEnvironment() {
  const originals = new Map(TIMED_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const beforeUnloadListeners = new Set();
  const cleanups = [];
  globalThis.window = {
    addEventListener(type, handler) {
      if (type === "beforeunload") beforeUnloadListeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "beforeunload") beforeUnloadListeners.delete(handler);
    },
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    reloadIsBlocked() {
      const event = new globalThis.Event("beforeunload", { cancelable: true });
      for (const handler of [...beforeUnloadListeners]) handler(event);
      return event.defaultPrevented;
    },
    ownCleanup(cleanup) {
      cleanups.push(cleanup);
    },
    async restore() {
      const errors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
      if (errors.length) throw new AggregateError(errors, "Leave guard cleanup failed");
    },
  };
}

function createProbe() {
  const state = { value: undefined };
  function Probe({ detailRef }) {
    state.value = useSkillLeaveGuard(detailRef);
    return null;
  }
  return { state, Probe };
}

async function mountProbe(env, Probe, detailRef) {
  let renderer;
  let mounted = true;
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => renderer?.unmount());
  };
  env.ownCleanup(unmount);
  await act(async () => {
    renderer = create(createElement(Probe, { detailRef }));
  });
  return {
    update: async (nextRef) => {
      await act(async () => {
        renderer.update(createElement(Probe, { detailRef: nextRef }));
      });
    },
    unmount,
  };
}

async function withEnvironment(run) {
  const env = installEnvironment();
  try {
    await run(env);
  } finally {
    await env.restore();
  }
}

function detailHandle(overrides = {}) {
  return {
    hasUnsavedChanges: () => false,
    save: async () => true,
    ...overrides,
  };
}

test("a clean editor lets the requested transition run immediately", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    detailRef.current = detailHandle();
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });
    assert.deepEqual(executed, ["action"]);
    assert.equal(state.value.pendingTransition, null);
    await mounted.unmount();
  });
});

test("a dirty editor holds the transition and the prompt appears instead", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    detailRef.current = detailHandle({ hasUnsavedChanges: () => true });
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });
    assert.deepEqual(executed, []);
    assert.notEqual(state.value.pendingTransition, null);
    await mounted.unmount();
  });
});

test("discarding continues the held action and clears the dirty flag", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    detailRef.current = detailHandle({ hasUnsavedChanges: () => true });
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    // The mounted editor reports its dirty state through the shared flag,
    // exactly as SkillDetail's onDirtyChange does in the real composition.
    await act(async () => {
      state.value.setDetailDirty(true);
    });
    assert.equal(env.reloadIsBlocked(), true, "reloading asks to keep unsaved edits");
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });
    await act(async () => {
      state.value.discardAndContinue();
    });
    assert.deepEqual(executed, ["action"]);
    assert.equal(state.value.pendingTransition, null);
    assert.equal(state.value.detailDirty, false);
    assert.equal(env.reloadIsBlocked(), false, "discarded edits no longer block reloading");
    await mounted.unmount();
  });
});

test("cancelling dismisses the prompt and keeps the current editor state", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    detailRef.current = detailHandle({ hasUnsavedChanges: () => true });
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });
    await act(async () => {
      state.value.cancelTransition();
    });
    assert.deepEqual(executed, []);
    assert.equal(state.value.pendingTransition, null);
    await mounted.unmount();
  });
});

test("saving continues the held action only when the save succeeds", async () => {
  await withEnvironment(async (env) => {
    let resolveSave;
    const detailRef = createRef();
    detailRef.current = detailHandle({
      hasUnsavedChanges: () => true,
      save: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });

    // Save failure keeps the prompt so the user can retry or discard.
    let firstSave;
    await act(async () => {
      firstSave = state.value.saveAndContinue();
    });
    assert.equal(state.value.transitionSaving, true, "the prompt shows the saving state");
    await act(async () => {
      resolveSave(false);
      await firstSave;
    });
    assert.equal(state.value.transitionSaving, false);
    assert.deepEqual(executed, []);
    assert.notEqual(state.value.pendingTransition, null);

    // Retrying with a successful save continues the original action.
    let secondSave;
    await act(async () => {
      secondSave = state.value.saveAndContinue();
    });
    await act(async () => {
      resolveSave(true);
      await secondSave;
    });
    assert.deepEqual(executed, ["action"]);
    assert.equal(state.value.pendingTransition, null);
    await mounted.unmount();
  });
});

test("while the detail ref is detached the tracked dirty flag gates transitions", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    const executed = [];
    await act(async () => {
      state.value.setDetailDirty(true);
    });
    await act(async () => {
      state.value.requestTransition(() => executed.push("action"));
    });
    assert.deepEqual(executed, []);
    assert.notEqual(state.value.pendingTransition, null);
    // With no editor mounted the save path falls back to "not saved" and
    // keeps the prompt; only an explicit discard continues the action.
    await act(async () => {
      await state.value.saveAndContinue();
    });
    assert.deepEqual(executed, []);
    assert.notEqual(state.value.pendingTransition, null);
    await act(async () => {
      state.value.discardAndContinue();
    });
    assert.deepEqual(executed, ["action"]);
    assert.equal(state.value.detailDirty, false);
    await mounted.unmount();
  });
});

test("the beforeunload guard follows the tracked dirty flag over time", async () => {
  await withEnvironment(async (env) => {
    const detailRef = createRef();
    const { state, Probe } = createProbe();
    const mounted = await mountProbe(env, Probe, detailRef);
    assert.equal(env.reloadIsBlocked(), false);
    await act(async () => {
      state.value.setDetailDirty(true);
    });
    assert.equal(env.reloadIsBlocked(), true);
    await act(async () => {
      state.value.setDetailDirty(false);
    });
    assert.equal(env.reloadIsBlocked(), false);
    await mounted.unmount();
  });
});
