import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { clearInterval, setInterval } from "node:timers";
import test from "node:test";
import { captureHandlers, isolatedAgentDirectory } from "./handlers-test-support.mjs";

const timestamp = "2026-08-06T00:00:00.000Z";
const turns = 320;
const answer = "窗口🙂完整内容".repeat(1200);

function history(id, cwd) {
  const entries = [{ type: "session", version: 3, id, cwd, timestamp }];
  for (let index = 0; index < turns; index += 1) {
    entries.push(
      {
        type: "message",
        id: `u-${index}`,
        parentId: index ? `a-${index - 1}` : null,
        timestamp,
        message: { role: "user", content: `question ${index}`, timestamp: 1 },
      },
      {
        type: "message",
        id: `a-${index}`,
        parentId: `u-${index}`,
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "text", text: answer }],
          provider: "test",
          model: "test",
          timestamp: 2,
        },
      },
    );
  }
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

test("large histories yield to other requests and paginate every UTF-8 message without gaps", async (t) => {
  const cwd = path.join(isolatedAgentDirectory, "large-project");
  const directory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "large-history");
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(cwd, "visible.txt"), "visible");
  const id = "large-async-history";
  const raw = history(id, cwd);
  assert.ok(Buffer.byteLength(raw) > 6 * 1024 * 1024);
  await writeFile(path.join(directory, `${id}.jsonl`), raw);
  const alias = path.join(isolatedAgentDirectory, "large-project-alias");
  await symlink(cwd, alias, "junction");
  const siblingIds = Array.from({ length: 160 }, (_, index) => `sibling-${index}`);
  await Promise.all(
    siblingIds.map((sibling) =>
      writeFile(
        path.join(directory, `${sibling}.jsonl`),
        JSON.stringify({ type: "session", version: 3, id: sibling, cwd: alias, timestamp }) + "\n",
      ),
    ),
  );
  const expectedIds = [id, ...siblingIds].sort();
  const { handlers } = await captureHandlers();
  await handlers["sessions.list"]({ cwd });
  let syncRealpaths = 0;
  const originalRealpath = fs.realpathSync;
  t.mock.method(
    fs,
    "realpathSync",
    Object.assign(
      (...args) => {
        syncRealpaths += 1;
        return originalRealpath(...args);
      },
      {
        native: (...args) => {
          syncRealpaths += 1;
          return originalRealpath.native(...args);
        },
      },
    ),
  );
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let ticks = 0;
  let maxLag = 0;
  let previous = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    maxLag = Math.max(maxLag, now - previous - 8);
    previous = now;
    ticks += 1;
  }, 8);
  t.after(() => clearInterval(interval));
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  const { context: newest } = await handlers["sessions.context"]({
    id,
    historyWindow: { maxTurns: 10, maxBytes: 1024 * 1024 },
  });
  assert.equal(yielded, true, "opening a cold large history lets the event loop run before returning");
  assert.deepEqual(
    newest.outline,
    Array.from({ length: turns }, (_, index) => ({ entryId: `u-${index}`, title: `question ${index}` })),
  );
  assert.equal(newest.totalMessages, turns * 2);
  const pages = [newest];
  let cursor = newest.previousCursor;
  assert.equal(typeof cursor, "string");
  while (cursor) {
    const [{ context }, listed, files] = await Promise.all([
      handlers["sessions.contextPage"]({ id, cursor, maxTurns: 10, maxBytes: 1024 * 1024 }),
      handlers["sessions.list"]({ cwd }),
      handlers["files.list"]({ path: cwd }),
    ]);
    assert.deepEqual(listed.sessions.map((session) => session.id).sort(), expectedIds);
    assert.deepEqual(
      files.entries.map((entry) => entry.name),
      ["visible.txt"],
    );
    pages.unshift(context);
    cursor = context.previousCursor;
    assert.ok(pages.length <= turns);
  }
  await new Promise((resolve) => setTimeout(resolve, 16));
  clearInterval(interval);
  assert.ok(ticks > 0);
  assert.equal(syncRealpaths, 0, "listing shared and aliased working directories never calls synchronous realpath");
  assert.ok(maxLag < 100, `event-loop lag ${maxLag.toFixed(1)}ms must stay below 100ms`);
  assert.equal(pages[0].truncatedBefore, false);
  assert.equal(pages[0].previousCursor, undefined);
  assert.deepEqual(
    pages.flatMap((page) => page.entryIds),
    Array.from({ length: turns }, (_, index) => [`u-${index}`, `a-${index}`]).flat(),
  );
  const messages = pages.flatMap((page) => page.messages);
  assert.equal(messages.length, turns * 2);
  for (let index = 0; index < turns; index += 1) {
    assert.equal(messages[index * 2].content, `question ${index}`);
    assert.deepEqual(messages[index * 2 + 1].content, [{ type: "text", text: answer }]);
  }
  t.diagnostic(
    `bytes=${Buffer.byteLength(raw)} turns=${turns} pages=${pages.length} sessions=${expectedIds.length} syncRealpaths=${syncRealpaths} maxLagMs=${maxLag.toFixed(1)}`,
  );
});

test("cold listing and renaming large histories never synchronously read the transcript", async (t) => {
  const cwd = path.join(isolatedAgentDirectory, "cold-project");
  const directory = path.join(process.env.PI_CODING_AGENT_SESSION_DIR, "cold-history");
  await mkdir(cwd, { recursive: true });
  await mkdir(directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  const id = "cold-async-history";
  await writeFile(path.join(directory, `${id}.jsonl`), history(id, cwd));
  const { handlers } = await captureHandlers();
  let syncReadBytes = 0;
  const readSync = fs.readSync;
  t.mock.method(fs, "readSync", (...args) => {
    const bytes = readSync(...args);
    syncReadBytes += bytes;
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.equal((await handlers["sessions.list"]({ cwd })).sessions[0].messageCount, turns * 2);
  await handlers["sessions.rename"]({ id, name: "Renamed asynchronously" });
  assert.equal((await handlers["sessions.get"]({ id })).info.name, "Renamed asynchronously");
  assert.equal(syncReadBytes, 0);
});
