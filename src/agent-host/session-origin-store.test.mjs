import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import fs, { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setInterval, clearInterval } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const { SessionOriginStore, getSessionOrigin } = await importTestBundle("src/agent-host/session-origin-store", {
  packages: "external",
  stdin: {
    contents: 'export { SessionOriginStore, getSessionOrigin } from "./session-origin-store.ts";',
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
  await withStore(async (filePath) => {
    const store = new SessionOriginStore(filePath);
    store.set("forked-session", { relation: "fork", createdAt: new Date(0).toISOString() });
    store.set("delegated-session", {
      relation: "delegate",
      createdBySessionId: "creator-session",
      createdAt: new Date(0).toISOString(),
    });

    await store.flush();
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
  await withStore(async (filePath) => {
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
  await withStore(async (filePath) => {
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

    await store.flush();
    const reopened = new SessionOriginStore(filePath);
    assert.equal(reopened.get("creator"), undefined);
    assert.equal(reopened.get("child")?.createdBySessionId, "creator");
    assert.equal(reopened.get("fork")?.relation, "fork");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(filePath, "utf8")).sessions).sort(), ["child", "fork"]);
  });
});

test("100 origin updates are visible immediately and publish once after 500ms", async (t) => {
  await withStore(async (filePath) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const rename = fs.rename.bind(fs);
    const published = Promise.withResolvers();
    let writes = 0;
    t.mock.method(fs, "rename", async (...args) => {
      await rename(...args);
      if (args[1] === filePath) {
        writes += 1;
        published.resolve();
      }
    });
    const store = new SessionOriginStore(filePath);
    for (let index = 0; index < 100; index += 1) {
      store.set("child", { relation: "delegate", createdBySessionId: `parent-${index}`, createdAt: "2026-01-01" });
      assert.equal(store.get("child").createdBySessionId, `parent-${index}`);
      assert.equal(existsSync(filePath), false);
    }
    t.mock.timers.tick(499);
    assert.equal(existsSync(filePath), false);
    store.set("child", { relation: "delegate", createdBySessionId: "latest", createdAt: "2026-01-01" });
    t.mock.timers.tick(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(existsSync(filePath), false, "the debounce restarts after the latest mutation");
    t.mock.timers.tick(499);
    const deadline = new globalThis.AbortController();
    try {
      await Promise.race([
        published.promise,
        delay(2_000, undefined, { signal: deadline.signal }).then(() =>
          assert.fail("debounced state was not published"),
        ),
      ]);
    } finally {
      deadline.abort();
    }
    await store.flush();
    assert.equal(writes, 1);
    assert.equal(new SessionOriginStore(filePath).get("child").createdBySessionId, "latest");
    t.mock.timers.tick(500);
    await store.flush();
    assert.equal(writes, 1);
  });
});

test("default stores remain isolated when the desktop directory changes", async () => {
  await withStore(async (filePath) => {
    const previous = process.env.PI_DESKTOP_USER_DATA;
    const directories = ["one", "two"].map((label) => {
      const directory = path.join(path.dirname(filePath), label);
      mkdirSync(directory);
      writeFileSync(
        path.join(directory, path.basename(filePath)),
        JSON.stringify({
          version: 1,
          sessions: { session: { relation: "delegate", createdBySessionId: label, createdAt: "2026-01-01" } },
        }),
      );
      return directory;
    });
    try {
      for (const index of [0, 1, 0]) {
        process.env.PI_DESKTOP_USER_DATA = directories[index];
        assert.equal(getSessionOrigin("session").createdBySessionId, index === 0 ? "one" : "two");
      }
    } finally {
      if (previous === undefined) delete process.env.PI_DESKTOP_USER_DATA;
      else process.env.PI_DESKTOP_USER_DATA = previous;
    }
  });
});

test("flush includes mutations received while an earlier snapshot is being written", async (t) => {
  await withStore(async (filePath) => {
    const store = new SessionOriginStore(filePath);
    const rename = fs.rename.bind(fs);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let writes = 0;
    t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === filePath && writes++ === 0) {
        entered.resolve();
        await release.promise;
      }
      return rename(...args);
    });
    store.set("child", { relation: "delegate", createdBySessionId: "first", createdAt: "2026-01-01" });
    const first = store.flush();
    try {
      await entered.promise;
      store.set("child", { relation: "delegate", createdBySessionId: "second", createdAt: "2026-01-01" });
      store.set("sibling", { relation: "delegate", createdBySessionId: "third", createdAt: "2026-01-01" });
      const concurrent = store.flush();
      release.resolve();
      await Promise.all([first, concurrent]);
      const reopened = new SessionOriginStore(filePath);
      assert.deepEqual(reopened.get("child"), {
        relation: "delegate",
        createdBySessionId: "second",
        createdAt: "2026-01-01",
      });
      assert.deepEqual(reopened.get("sibling"), {
        relation: "delegate",
        createdBySessionId: "third",
        createdAt: "2026-01-01",
      });
      assert.equal(writes, 2);
    } finally {
      release.resolve();
      await first;
      await store.flush();
    }
  });
});

test("a failed atomic write keeps the previous file and can be retried without losing memory changes", async (t) => {
  await withStore(async (filePath) => {
    const store = new SessionOriginStore(filePath);
    store.set("child", { relation: "delegate", createdBySessionId: "first", createdAt: "2026-01-01" });
    await store.flush();
    const rename = fs.rename.bind(fs);
    let fail = true;
    t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === filePath && fail) throw Object.assign(new Error("disk unavailable"), { code: "EACCES" });
      return rename(...args);
    });
    store.set("child", { relation: "delegate", createdBySessionId: "second", createdAt: "2026-01-01" });
    await assert.rejects(store.flush(), { code: "EACCES" });
    assert.deepEqual(store.get("child"), {
      relation: "delegate",
      createdBySessionId: "second",
      createdAt: "2026-01-01",
    });
    assert.deepEqual(new SessionOriginStore(filePath).get("child"), {
      relation: "delegate",
      createdBySessionId: "first",
      createdAt: "2026-01-01",
    });
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), [path.basename(filePath)]);
    fail = false;
    await store.flush();
    assert.deepEqual(new SessionOriginStore(filePath).get("child"), {
      relation: "delegate",
      createdBySessionId: "second",
      createdAt: "2026-01-01",
    });
    if (process.platform !== "win32") assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });
});

test("loaded state remains authoritative and returned records cannot mutate it", async () => {
  await withStore(async (filePath) => {
    const store = new SessionOriginStore(filePath);
    store.set("child", { relation: "delegate", createdBySessionId: "first", createdAt: "2026-01-01" });
    await store.flush();
    writeFileSync(filePath, JSON.stringify({ version: 1, sessions: {} }));
    const record = store.get("child");
    Object.assign(record, { relation: "delegate", createdBySessionId: "second", createdAt: "2026-01-01" });
    assert.deepEqual(store.get("child"), {
      relation: "delegate",
      createdBySessionId: "first",
      createdAt: "2026-01-01",
    });
  });
});

test("a transient background failure retries concurrent mutations without an explicit flush", async (t) => {
  await withStore(async (filePath) => {
    const store = new SessionOriginStore(filePath);
    const rename = fs.rename.bind(fs);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let failed = false;
    t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === filePath && !failed) {
        failed = true;
        entered.resolve();
        await release.promise;
        throw Object.assign(new Error("temporarily busy"), { code: "EBUSY" });
      }
      return rename(...args);
    });
    const keepAlive = setInterval(() => {}, 50);
    try {
      store.set("first", { relation: "delegate", createdBySessionId: "parent-1", createdAt: "2026-01-01" });
      await entered.promise;
      store.set("second", { relation: "delegate", createdBySessionId: "parent-2", createdAt: "2026-01-01" });
      release.resolve();
      await delay(750);
      const reopened = new SessionOriginStore(filePath);
      assert.deepEqual(reopened.get("first"), {
        relation: "delegate",
        createdBySessionId: "parent-1",
        createdAt: "2026-01-01",
      });
      assert.deepEqual(reopened.get("second"), {
        relation: "delegate",
        createdBySessionId: "parent-2",
        createdAt: "2026-01-01",
      });
    } finally {
      release.resolve();
      clearInterval(keepAlive);
      await store.flush();
    }
  });
});
