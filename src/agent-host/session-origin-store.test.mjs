import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const { SessionOriginStore } = await importTestBundle("src/agent-host/session-origin-store", {
  packages: "external",
  stdin: {
    contents: 'export { SessionOriginStore } from "./session-origin-store.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

async function withStore(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-session-origins-"));
  const filePath = path.join(directory, "session-origins.json");
  try {
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("session origins keep a fork and a delegation distinguishable across reopenings", async () => {
  await withStore((filePath) => {
    const store = new SessionOriginStore(filePath);
    store.set("forked-session", { relation: "fork", createdAt: new Date(0).toISOString() });
    store.set("delegated-session", {
      relation: "delegate",
      createdBySessionId: "creator-session",
      createdAt: new Date(0).toISOString(),
    });

    const reopened = new SessionOriginStore(filePath);
    assert.deepEqual(reopened.get("forked-session"), { relation: "fork", createdAt: new Date(0).toISOString() });
    assert.deepEqual(reopened.get("delegated-session"), {
      relation: "delegate",
      createdBySessionId: "creator-session",
      createdAt: new Date(0).toISOString(),
    });
    assert.equal(reopened.get("unknown-session"), undefined);
  });
});

test("a delegation without a creator and a malformed relation are not recorded", async () => {
  await withStore((filePath) => {
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        sessions: {
          "no-creator": { relation: "delegate", createdAt: "2026-01-01T00:00:00.000Z" },
          unknown: { relation: "adopted", createdAt: "2026-01-01T00:00:00.000Z" },
          good: { relation: "fork", createdAt: "2026-01-01T00:00:00.000Z" },
        },
      }),
      "utf8",
    );

    const store = new SessionOriginStore(filePath);
    assert.equal(store.get("no-creator"), undefined);
    assert.equal(store.get("unknown"), undefined);
    assert.equal(store.get("good")?.relation, "fork");
  });
});

test("deleting a session's origin leaves the records of the sessions it created in place", async () => {
  await withStore((filePath) => {
    const store = new SessionOriginStore(filePath);
    store.set("creator", {
      relation: "delegate",
      createdBySessionId: "grandparent",
      createdAt: new Date(0).toISOString(),
    });
    store.set("child", { relation: "delegate", createdBySessionId: "creator", createdAt: new Date(0).toISOString() });
    store.set("fork", { relation: "fork", createdAt: new Date(0).toISOString() });

    store.delete("creator");
    store.delete("creator");

    const reopened = new SessionOriginStore(filePath);
    assert.equal(reopened.get("creator"), undefined);
    assert.equal(reopened.get("child")?.createdBySessionId, "creator");
    assert.equal(reopened.get("fork")?.relation, "fork");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(filePath, "utf8")).sessions).sort(), ["child", "fork"]);
  });
});
