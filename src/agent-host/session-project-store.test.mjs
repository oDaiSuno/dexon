import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import fs, { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setInterval, clearInterval } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";

const { SessionProjectStore, getSessionProject } = await importTestBundle("src/agent-host/session-project-store", {
  packages: "external",
  stdin: {
    contents: 'export { SessionProjectStore, getSessionProject } from "./session-project-store.ts";',
    resolveDir: import.meta.dirname,
    loader: "ts",
  },
});

async function withStore(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "dexon-session-projects-"));
  const filePath = path.join(directory, "session-projects.json");
  try {
    await run(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("100 project updates are visible immediately and publish once after 500ms", async (t) => {
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
    const store = new SessionProjectStore(filePath);
    for (let index = 0; index < 100; index += 1) {
      store.remember("child", { projectRoot: `project-${index}` });
      assert.equal(store.get("child").projectRoot, `project-${index}`);
      assert.equal(existsSync(filePath), false);
    }
    t.mock.timers.tick(499);
    assert.equal(existsSync(filePath), false);
    store.remember("child", { projectRoot: "latest" });
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
    assert.equal(new SessionProjectStore(filePath).get("child").projectRoot, "latest");
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
          sessions: { session: { projectRoot: label } },
        }),
      );
      return directory;
    });
    try {
      for (const index of [0, 1, 0]) {
        process.env.PI_DESKTOP_USER_DATA = directories[index];
        assert.equal(getSessionProject("session").projectRoot, index === 0 ? "one" : "two");
      }
    } finally {
      if (previous === undefined) delete process.env.PI_DESKTOP_USER_DATA;
      else process.env.PI_DESKTOP_USER_DATA = previous;
    }
  });
});

test("flush includes mutations received while an earlier snapshot is being written", async (t) => {
  await withStore(async (filePath) => {
    const store = new SessionProjectStore(filePath);
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
    store.remember("child", { projectRoot: "first" });
    const first = store.flush();
    try {
      await entered.promise;
      store.remember("child", { projectRoot: "second" });
      store.remember("sibling", { projectRoot: "third" });
      const concurrent = store.flush();
      release.resolve();
      await Promise.all([first, concurrent]);
      const reopened = new SessionProjectStore(filePath);
      assert.deepEqual(reopened.get("child"), { projectRoot: "second" });
      assert.deepEqual(reopened.get("sibling"), { projectRoot: "third" });
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
    const store = new SessionProjectStore(filePath);
    store.remember("child", { projectRoot: "first" });
    await store.flush();
    const rename = fs.rename.bind(fs);
    let fail = true;
    t.mock.method(fs, "rename", async (...args) => {
      if (args[1] === filePath && fail) throw Object.assign(new Error("disk unavailable"), { code: "EACCES" });
      return rename(...args);
    });
    store.remember("child", { projectRoot: "second" });
    await assert.rejects(store.flush(), { code: "EACCES" });
    assert.deepEqual(store.get("child"), { projectRoot: "second" });
    assert.deepEqual(new SessionProjectStore(filePath).get("child"), { projectRoot: "first" });
    assert.deepEqual(await fs.readdir(path.dirname(filePath)), [path.basename(filePath)]);
    fail = false;
    await store.flush();
    assert.deepEqual(new SessionProjectStore(filePath).get("child"), { projectRoot: "second" });
    if (process.platform !== "win32") assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
  });
});

test("loaded state remains authoritative and returned records cannot mutate it", async () => {
  await withStore(async (filePath) => {
    const store = new SessionProjectStore(filePath);
    store.remember("child", { projectRoot: "first" });
    await store.flush();
    writeFileSync(filePath, JSON.stringify({ version: 1, sessions: {} }));
    const record = store.get("child");
    Object.assign(record, { projectRoot: "second" });
    assert.deepEqual(store.get("child"), { projectRoot: "first" });
  });
});

test("a transient background failure retries concurrent mutations without an explicit flush", async (t) => {
  await withStore(async (filePath) => {
    const store = new SessionProjectStore(filePath);
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
      store.remember("first", { projectRoot: "/repo-1" });
      await entered.promise;
      store.remember("second", { projectRoot: "/repo-2" });
      release.resolve();
      await delay(750);
      const reopened = new SessionProjectStore(filePath);
      assert.deepEqual(reopened.get("first"), { projectRoot: "/repo-1" });
      assert.deepEqual(reopened.get("second"), { projectRoot: "/repo-2" });
    } finally {
      release.resolve();
      clearInterval(keepAlive);
      await store.flush();
    }
  });
});
