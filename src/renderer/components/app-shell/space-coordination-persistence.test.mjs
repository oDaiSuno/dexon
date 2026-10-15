import { realRendererGraphOptions } from "../renderer-real-graph.mjs";
import { installApiHostBridge } from "../../../../tests/support/api-host.mjs";
import { importTestBundle } from "#test-bundle";
import { createDeferred } from "#test-timing";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { act } from "react";
import { mountCoordination, createIo, settle } from "./space-coordination-harness.mjs";

// Persistence-lifecycle behavior of the Phase 6 space coordination owner
// (review round 1 findings): the remembered state belongs to the current
// space and only the latest write may set it; unmounting invalidates
// in-flight restores; the production default I/O reads the preference once
// per mount. Injected recorders and harness stubs keep real bridges and
// directories out of the picture.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { resetRpc, useSpaceCoordination } = await importTestBundle("app-shell-space-coordination-persistence", {
  stdin: {
    contents:
      'export { useSpaceCoordination } from "./src/renderer/components/app-shell/use-space-coordination.ts";' +
      '\nexport {resetRpc} from "./src/renderer/lib/api-client.ts";',
    resolveDir: projectRoot,
    sourcefile: "space-coordination-persistence-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  ...realRendererGraphOptions(projectRoot),
});

test("a new space commit starts unconfirmed and is remembered only after its own write", async (t) => {
  const pendingWrites = new Map();
  const record = createIo({
    persistSpaceCwd: (path) => {
      const deferred = createDeferred();
      pendingWrites.set(path, deferred);
      return deferred.promise;
    },
  });
  const mounted = await mountCoordination(t, useSpaceCoordination, record);
  await settle();

  // The personal space commit is not yet confirmed (write still pending).
  assert.equal(pendingWrites.has("/Users/tester/.dexon"), true);
  assert.equal(mounted.get().remembered, false);

  pendingWrites.get("/Users/tester/.dexon").resolve();
  await settle();
  assert.equal(mounted.get().remembered, true);

  // A new commit must NOT inherit the previous directory's remembered state.
  await act(async () => {
    mounted.get().noteExternalCwd("/next/project");
  });
  assert.equal(mounted.get().remembered, false);
  pendingWrites.get("/next/project").resolve();
  await settle();
  assert.equal(mounted.get().remembered, true);
  await mounted.unmount();
});

test("late completion of an older write cannot flip the current space's persistence state", async (t) => {
  const pendingWrites = new Map();
  const record = createIo({
    persistSpaceCwd: (path) => {
      const deferred = createDeferred();
      pendingWrites.set(path, deferred);
      return deferred.promise;
    },
  });
  const mounted = await mountCoordination(t, useSpaceCoordination, record);
  await settle();

  // Commit /A (write pending), then switch to /B (write pending).
  await act(async () => {
    mounted.get().noteExternalCwd("/A");
  });
  await act(async () => {
    mounted.get().noteExternalCwd("/B");
  });
  assert.equal(pendingWrites.size, 3); // personal + /A + /B

  // /B's write succeeds first — the current space is remembered.
  pendingWrites.get("/B").resolve();
  await settle();
  assert.equal(mounted.get().remembered, true);
  assert.equal(mounted.get().rememberFailed, false);

  // The current space's own failing write is honestly reported.
  await act(async () => {
    mounted.get().noteExternalCwd("/C");
  });
  pendingWrites.get("/C").reject(new Error("disk full"));
  await settle();
  assert.equal(mounted.get().remembered, false);
  assert.equal(mounted.get().rememberFailed, true);

  // A STALE write that was still pending completes successfully only now —
  // it must not flip the current space's persistence state in either
  // direction.
  pendingWrites.get("/Users/tester/.dexon").resolve();
  await settle();
  assert.equal(mounted.get().remembered, false);
  assert.equal(mounted.get().rememberFailed, true);

  // A stale failure cannot clear the current state either.
  pendingWrites.get("/A").reject(new Error("disk full"));
  await settle();
  assert.equal(mounted.get().remembered, false);
  assert.equal(mounted.get().rememberFailed, true);
  await mounted.unmount();
});

test("unmounting invalidates in-flight restores so a stale owner never writes", async (t) => {
  let storedReads = 0;
  let releaseFirst = () => {};
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const record = createIo({
    readStoredSpaceCwd: async () => {
      storedReads += 1;
      return storedReads === 1 ? "/first/space" : "/second/space";
    },
    validateSpace: async (value) => {
      record.calls.validated.push(value);
      if (record.calls.validated.length === 1) {
        await firstGate;
        return value;
      }
      return value;
    },
  });
  const first = await mountCoordination(t, useSpaceCoordination, record);
  await settle();
  assert.equal(first.get().spacePhase.phase, "preparing");
  await first.unmount();

  const second = await mountCoordination(t, useSpaceCoordination, record, {});
  await settle();
  assert.deepEqual(second.get().spacePhase, { phase: "ready", cwd: "/second/space" });
  assert.deepEqual(record.calls.persisted, ["/second/space"]);

  // Release the first mount's validation: the stale owner must stay dead.
  releaseFirst();
  await settle();
  assert.deepEqual(second.get().spacePhase, { phase: "ready", cwd: "/second/space" });
  assert.deepEqual(record.calls.persisted, ["/second/space"]);
  await second.unmount();
});

test("production default I/O reads the preference once per mount, not per render", async (t) => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const bridgeCalls = { getUiState: 0, persisted: [], validateCwd: [] };
  globalThis.window = {
    piBridge: {
      getUiState: async () => {
        bridgeCalls.getUiState += 1;
        return { lastSpaceCwd: "/stored/space" };
      },
      setUiState: async (patch) => {
        bridgeCalls.persisted.push(patch);
      },
    },
  };
  globalThis.__spaceIoHarness = {
    validateCwd: async (path) => {
      bridgeCalls.validateCwd.push(path);
      return { ok: true, path };
    },
    defaultCwd: async () => {
      throw new Error("defaultCwd must not run for a stored space");
    },
  };
  const hostBoundary = installApiHostBridge(globalThis.window, () => globalThis.__spaceIoHarness, resetRpc);
  try {
    // No injected io: the hook must fall back to its production default I/O.
    const mounted = await mountCoordination(t, useSpaceCoordination, { io: undefined });
    await settle();
    assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/stored/space" });
    assert.equal(bridgeCalls.getUiState, 1);

    // Unrelated re-renders must not re-read the preference.
    await mounted.rerender({ sessionFound: false });
    await mounted.rerender({ sessionFound: false });
    await mounted.rerender({ sessionFound: false });
    await settle();
    assert.equal(bridgeCalls.getUiState, 1);
    assert.deepEqual(bridgeCalls.validateCwd, ["/stored/space"]);
    assert.deepEqual(bridgeCalls.persisted, [{ lastSpaceCwd: "/stored/space" }]);
    await mounted.unmount();
  } finally {
    hostBoundary.close();
    delete globalThis.__spaceIoHarness;
    if (originalWindowDescriptor) Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    else delete globalThis.window;
  }
});
