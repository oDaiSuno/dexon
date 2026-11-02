import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { DesktopSessionToolStore, toolIntentFromNames } = await importTestBundle("src/agent-host/session-tool-store", {
  packages: "external",
  stdin: {
    contents:
      'export { DesktopSessionToolStore } from "./session-tool-store.ts"; export { toolIntentFromNames } from "./agent-session/tool-intent.ts";',
    resolveDir: import.meta.dirname,
    sourcefile: "session-tool-store-test-entry.ts",
    loader: "ts",
  },
});

async function withSidecar(t, contents, run) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-session-tools-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "session-tools.json");
  if (contents !== undefined) writeFileSync(filePath, contents, "utf8");
  return run(filePath);
}

test("a coding selection round-trips through the v2 sidecar with a defensive copy", async (t) => {
  await withSidecar(t, undefined, (filePath) => {
    const store = new DesktopSessionToolStore(filePath);
    store.set("session-one", toolIntentFromNames(["read", "bash"]));

    assert.deepEqual(store.get("session-one"), { kind: "agent", coding: ["read", "bash"] });

    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.sessions["session-one"].intent, { kind: "agent", coding: ["read", "bash"] });
    assert.equal(Number.isNaN(Date.parse(persisted.sessions["session-one"].updatedAt)), false);

    assert.deepEqual(new DesktopSessionToolStore(filePath).get("session-one"), {
      kind: "agent",
      coding: ["read", "bash"],
    });
  });
});

test("a bare session survives a restart because the sidecar stores the intent, not an empty tool list", async (t) => {
  await withSidecar(t, undefined, (filePath) => {
    new DesktopSessionToolStore(filePath).set("bare-session", toolIntentFromNames([]));
    assert.deepEqual(new DesktopSessionToolStore(filePath).get("bare-session"), { kind: "bare" });
  });
});

test("a full coding selection collapses to an unambiguous all", async (t) => {
  await withSidecar(t, undefined, (filePath) => {
    const store = new DesktopSessionToolStore(filePath);
    const all = ["read", "bash", "edit", "write", "grep", "find", "ls"];
    store.set("full", toolIntentFromNames(all));
    assert.deepEqual(store.get("full"), { kind: "agent", coding: "all" });
  });
});

test("a version 1 sidecar migrates to the intent shape on read", async (t) => {
  const legacy = JSON.stringify({
    version: 1,
    sessions: {
      "kept-session": { toolNames: [" read ", "read", "bash"], updatedAt: "2026-01-02T03:04:05.000Z" },
      "full-session": {
        toolNames: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        updatedAt: "2026-01-02T03:04:05.000Z",
      },
      "bare-session": { toolNames: [], updatedAt: "2026-01-02T03:04:05.000Z" },
      "broken-session": { toolNames: "read" },
    },
  });
  await withSidecar(t, legacy, (filePath) => {
    const store = new DesktopSessionToolStore(filePath);
    assert.deepEqual(store.get("kept-session"), { kind: "agent", coding: ["read", "bash"] });
    assert.deepEqual(store.get("bare-session"), { kind: "bare" });
    assert.deepEqual(store.get("full-session"), { kind: "agent", coding: "all" });
    assert.equal(store.get("broken-session"), undefined);

    store.set("kept-session", toolIntentFromNames(["edit"]));
    const rewritten = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(rewritten.version, 2);
  });
});

test("a corrupt sidecar is ignored and the next write persists cleanly", async (t) => {
  await withSidecar(t, "not-json", (filePath) => {
    const store = new DesktopSessionToolStore(filePath);
    assert.equal(store.get("missing"), undefined);
    store.set("session-two", toolIntentFromNames(["edit"]));
    assert.deepEqual(new DesktopSessionToolStore(filePath).get("session-two"), {
      kind: "agent",
      coding: ["edit"],
    });
  });
});

test("an empty session id or an unreadable intent is rejected instead of written", async (t) => {
  await withSidecar(t, undefined, (filePath) => {
    const store = new DesktopSessionToolStore(filePath);
    assert.throws(() => store.set("  ", toolIntentFromNames(["read"])), /Invalid session tool state/);
    assert.throws(() => store.set("session", { kind: "agent", coding: "nope" }), /Invalid session tool state/);
  });
});
