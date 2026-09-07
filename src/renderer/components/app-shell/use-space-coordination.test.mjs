import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { act } from "react";
import { mountCoordination, createIo, settle } from "./space-coordination-harness.mjs";

// Behavior tests for the Phase 6 space coordination owner: the three-tier
// startup decision execution, unavailable/retry/return actions, honest
// preference persistence, late-result generation guards, and session-cwd
// alignment. All I/O goes through injected recorders — no real bridge, home
// directory, or Agent Host is touched. Persistence-lifecycle behavior lives
// in space-coordination-persistence.test.mjs.

const projectRoot = path.resolve(import.meta.dirname, "../../../..");

const { useSpaceCoordination } = await importTestBundle("app-shell-space-coordination", {
  stdin: {
    contents: 'export { useSpaceCoordination } from "./src/renderer/components/app-shell/use-space-coordination.ts";',
    resolveDir: projectRoot,
    sourcefile: "space-coordination-test-entry.ts",
    loader: "ts",
  },
  tsconfig: path.join(projectRoot, "tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "space-coordination-stubs",
      setup(build) {
        build.onResolve({ filter: /(^|\/)api-client$/ }, () => ({ path: "api", namespace: "space-coordination" }));
        build.onLoad({ filter: /.*/, namespace: "space-coordination" }, () => ({
          contents:
            "export const validateCwd = async (path) => {\n" +
            "  const harness = globalThis.__spaceIoHarness;\n" +
            "  if (harness) return harness.validateCwd(path);\n" +
            "  throw new Error('stub validateCwd must not be called');\n" +
            "};\n" +
            "export const defaultCwd = async () => {\n" +
            "  const harness = globalThis.__spaceIoHarness;\n" +
            "  if (harness) return harness.defaultCwd();\n" +
            "  throw new Error('stub defaultCwd must not be called');\n" +
            "};",
          loader: "js",
        }));
      },
    },
  ],
});

test("first run prepares the personal space, readies it, and remembers it", async () => {
  const record = createIo();
  const mounted = await mountCoordination(useSpaceCoordination, record, { sessionResolved: true, sessionFound: false });
  await settle();

  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/Users/tester/.dexon" });
  assert.equal(record.calls.prepared, 1);
  assert.deepEqual(record.calls.validated, []);
  assert.deepEqual(record.calls.persisted, ["/Users/tester/.dexon"]);
  assert.equal(mounted.get().remembered, true);
  assert.equal(mounted.get().rememberFailed, false);
  assert.equal(mounted.get().spaceCwd, "/Users/tester/.dexon");
  await mounted.unmount();
});

test("stored space is restored through real validation without preparing", async () => {
  const record = createIo({ readStoredSpaceCwd: async () => "/last/space" });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/last/space" });
  assert.deepEqual(record.calls.validated, ["/last/space"]);
  assert.equal(record.calls.prepared, 0);
  assert.deepEqual(record.calls.persisted, ["/last/space"]);
  await mounted.unmount();
});

test("the decision waits for the explicit-session branch and defers to a found session", async () => {
  const record = createIo({ readStoredSpaceCwd: async () => "/last/space" });
  const mounted = await mountCoordination(useSpaceCoordination, record, {
    sessionIntent: "s1",
    sessionResolved: false,
    sessionFound: false,
  });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "idle" });
  assert.deepEqual(record.calls.validated, []);
  assert.equal(record.calls.prepared, 0);

  // Session link resolves as found → explicit; no space operation at all.
  await mounted.rerender({ sessionResolved: true, sessionFound: true });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "idle" });
  assert.deepEqual(record.calls.validated, []);
  assert.equal(record.calls.prepared, 0);
  await mounted.unmount();
});

test("a confirmed-absent explicit session falls through to the stored space", async () => {
  const record = createIo({ readStoredSpaceCwd: async () => "/last/space" });
  const mounted = await mountCoordination(useSpaceCoordination, record, {
    sessionIntent: "s1",
    sessionResolved: false,
    sessionFound: false,
  });
  await settle();
  await mounted.rerender({ sessionResolved: true, sessionFound: false });
  await settle();

  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/last/space" });
  assert.deepEqual(record.calls.validated, ["/last/space"]);
  await mounted.unmount();
});

test("an invalid stored space becomes unavailable without silently replacing it", async () => {
  const record = createIo({
    readStoredSpaceCwd: async () => "/gone/space",
    validateSpace: async () => {
      throw new Error("Directory does not exist");
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  assert.deepEqual(mounted.get().spacePhase, {
    phase: "unavailable",
    attempted: "stored",
    reason: "Directory does not exist",
  });
  assert.deepEqual(record.calls.persisted, []);
  assert.equal(mounted.get().remembered, false);
  await mounted.unmount();
});

test("retry recovers the stored space once validation succeeds again", async () => {
  let shouldFail = true;
  const record = createIo({
    readStoredSpaceCwd: async () => "/gone/space",
    validateSpace: async (value) => {
      if (shouldFail) throw new Error("Directory does not exist");
      return value;
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.equal(mounted.get().spacePhase.phase, "unavailable");

  shouldFail = false;
  await act(async () => {
    mounted.get().retry();
  });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/gone/space" });
  assert.equal(mounted.get().remembered, true);
  await mounted.unmount();
});

test("personal prepare failure surfaces the reason and return-to-personal recovers", async () => {
  let shouldFail = true;
  const record = createIo({
    preparePersonalSpace: async () => {
      if (shouldFail) throw new Error("path is occupied by a file");
      return "/Users/tester/.dexon";
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.deepEqual(mounted.get().spacePhase, {
    phase: "unavailable",
    attempted: "personal",
    reason: "path is occupied by a file",
  });
  assert.deepEqual(mounted.get().spaceCwd, null);

  shouldFail = false;
  await act(async () => {
    mounted.get().returnToPersonalSpace();
  });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/Users/tester/.dexon" });
  await mounted.unmount();
});

test("a user space change discards late validation results and is not overwritten", async () => {
  let releaseValidation = () => {};
  const gate = new Promise((resolve) => {
    releaseValidation = resolve;
  });
  const record = createIo({
    readStoredSpaceCwd: async () => "/last/space",
    validateSpace: async (value) => {
      await gate;
      return value;
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.equal(mounted.get().spacePhase.phase, "preparing");

  // The user picks a different project while the restore is still in flight.
  await act(async () => {
    mounted.get().noteExternalCwd("/picked/project");
  });
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/picked/project" });
  assert.deepEqual(record.calls.persisted, ["/picked/project"]);

  releaseValidation();
  await settle();
  // The late restore result must not overwrite the user's choice nor persist.
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/picked/project" });
  assert.deepEqual(record.calls.persisted, ["/picked/project"]);
  await mounted.unmount();
});

test("echoes of the committed space are ignored and do not re-persist", async () => {
  const record = createIo();
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.deepEqual(record.calls.persisted, ["/Users/tester/.dexon"]);

  await act(async () => {
    mounted.get().noteExternalCwd("/Users/tester/.dexon");
  });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/Users/tester/.dexon" });
  assert.deepEqual(record.calls.persisted, ["/Users/tester/.dexon"]);
  assert.equal(record.calls.prepared, 1);
  await mounted.unmount();
});

test("session cwd changes align the space (deep link / session creation path)", async () => {
  const record = createIo();
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  await mounted.rerender({ sessionCwd: "/sessions/cwd" });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/sessions/cwd" });
  assert.deepEqual(record.calls.persisted, ["/Users/tester/.dexon", "/sessions/cwd"]);
  await mounted.unmount();
});

test("preference write failure never fakes being remembered", async () => {
  let shouldFail = true;
  const record = createIo({
    persistSpaceCwd: async () => {
      if (shouldFail) throw new Error("disk full");
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  assert.equal(mounted.get().spacePhase.phase, "ready");
  assert.equal(mounted.get().remembered, false);
  assert.equal(mounted.get().rememberFailed, true);

  // A later successful write clears the failure and marks the space remembered.
  shouldFail = false;
  await act(async () => {
    mounted.get().noteExternalCwd("/another/project");
  });
  await settle();
  assert.equal(mounted.get().remembered, true);
  assert.equal(mounted.get().rememberFailed, false);
  await mounted.unmount();
});

test("retry from a ready space is a no-op and no decision reruns after one commit", async () => {
  const record = createIo();
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  await act(async () => {
    mounted.get().retry();
  });
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/Users/tester/.dexon" });
  assert.equal(record.calls.prepared, 1);
  await mounted.unmount();
});

test("a committed external space short-circuits the pending startup decision", async () => {
  let releaseStored = () => {};
  const storedGate = new Promise((resolve) => {
    releaseStored = resolve;
  });
  const record = createIo({
    readStoredSpaceCwd: async () => {
      await storedGate;
      return "/last/space";
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "idle" });

  // The user (or a deep link) commits a space before the preference is read.
  await act(async () => {
    mounted.get().noteExternalCwd("/user/choice");
  });
  releaseStored();
  await settle();
  assert.deepEqual(mounted.get().spacePhase, { phase: "ready", cwd: "/user/choice" });
  assert.deepEqual(record.calls.validated, []);
  assert.equal(record.calls.prepared, 0);
  await mounted.unmount();
});

test("openCurrentFolder forwards the ready space to the desktop bridge", async () => {
  const record = createIo();
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  await mounted.get().openCurrentFolder();
  assert.deepEqual(record.calls.opened, ["/Users/tester/.dexon"]);
  await mounted.unmount();
});

test("openCurrentFolder does nothing without a ready space", async () => {
  const record = createIo({
    readStoredSpaceCwd: async () => "/gone/space",
    validateSpace: async () => {
      throw new Error("Directory does not exist");
    },
  });
  const mounted = await mountCoordination(useSpaceCoordination, record);
  await settle();

  await mounted.get().openCurrentFolder();
  assert.deepEqual(record.calls.opened, []);
  await mounted.unmount();
});

test("remounting the shell re-runs the startup decision and re-authorizes the space", async () => {
  const record = createIo({ readStoredSpaceCwd: async () => "/last/space" });
  const first = await mountCoordination(useSpaceCoordination, record);
  await settle();
  assert.deepEqual(first.get().spacePhase, { phase: "ready", cwd: "/last/space" });
  await first.unmount();

  // Host restart remounts the whole shell: a fresh coordinator must re-validate
  // (the in-process allowed roots died with the old host).
  const second = await mountCoordination(useSpaceCoordination, record, {});
  await settle();
  assert.deepEqual(second.get().spacePhase, { phase: "ready", cwd: "/last/space" });
  assert.deepEqual(record.calls.validated, ["/last/space", "/last/space"]);
  assert.deepEqual(record.calls.persisted, ["/last/space", "/last/space"]);
  await second.unmount();
});
