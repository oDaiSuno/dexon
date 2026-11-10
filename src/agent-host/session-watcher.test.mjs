import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
import { classifySessionWatchChange, didSessionRootsChange } from "./session-watch-policy.ts";

const fixtureRoot = fs.mkdtempSync(path.join(tmpdir(), "pi-session-watch-"));
const sessionsRoot = path.join(fixtureRoot, "configured-sessions");
process.env.PI_CODING_AGENT_DIR = fixtureRoot;
process.env.PI_CODING_AGENT_SESSION_DIR = sessionsRoot;
test.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
const { startSessionWatcher, sessionIndex, AgentSessionWrapper } = await importTestBundle("session-watcher", {
  packages: "external",
  stdin: {
    contents:
      'export { startSessionWatcher } from "./session-watcher"; export { sessionIndex } from "./session-index"; export { AgentSessionWrapper } from "./agent-session/wrapper";',
    resolveDir: import.meta.dirname,
  },
});
const { SessionManager } = await import("@earendil-works/pi-coding-agent");

test("session events are relative to sessionsRoot and reject traversal", () => {
  assert.deepEqual(classifySessionWatchChange(sessionsRoot, "project/id.jsonl"), {
    kind: "file",
    path: path.join(sessionsRoot, "project/id.jsonl"),
  });
  assert.deepEqual(classifySessionWatchChange(sessionsRoot, "../outside.jsonl"), { kind: "ignore" });
  assert.deepEqual(classifySessionWatchChange(sessionsRoot, null), { kind: "unknown" });
  for (const filename of ["settings.json", "session-cache.tmp", "notes.txt", "project/.DS_Store"]) {
    assert.deepEqual(classifySessionWatchChange(sessionsRoot, Buffer.from(filename)), { kind: "ignore" });
  }
});

test("directory events reconcile only the affected subtree", (t) => {
  const directory = path.join(sessionsRoot, "vanished-project");
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(classifySessionWatchChange(sessionsRoot, "vanished-project"), { kind: "subtree", dir: directory });
  fs.rmSync(directory, { recursive: true });
  assert.deepEqual(classifySessionWatchChange(sessionsRoot, "vanished-project"), { kind: "subtree", dir: directory });
});

test("message appends preserve allowed roots while membership changes invalidate them", () => {
  const previous = { cwd: "/project/worktree", projectRoot: "/project", messageCount: 1 };
  assert.equal(didSessionRootsChange(previous, { ...previous, messageCount: 2 }), false);
  assert.equal(didSessionRootsChange(null, previous), true);
  assert.equal(didSessionRootsChange(previous, null), true);
  assert.equal(didSessionRootsChange(null, null), true);
  assert.equal(didSessionRootsChange(previous, { ...previous, cwd: "/other" }), true);
  assert.equal(didSessionRootsChange(previous, { ...previous, projectRoot: "/other" }), true);
});

function watcherFixture(t) {
  let notify;
  let watched;
  let watchCount = 0;
  const watcher = new EventEmitter();
  watcher.close = () => {};
  t.mock.method(fs, "watch", (root, _options, callback) => {
    assert.ok(fs.statSync(root).isDirectory(), "the watched directory exists before fs.watch");
    watched = root;
    watchCount += 1;
    notify = callback;
    return watcher;
  });
  const events = [];
  const waiting = [];
  const stop = startSessionWatcher({
    emit: (_topic, _key, event) => {
      events.push(event);
      waiting.shift()?.(event);
    },
  });
  t.after(stop);
  return {
    events,
    watched,
    watcher,
    watchCount: () => watchCount,
    notify: (name) => notify("change", name),
    next: () => new Promise((resolve) => waiting.push(resolve)),
  };
}

test("watcher creates and watches the configured session root, not the parent agent directory", (t) => {
  fs.rmSync(sessionsRoot, { recursive: true, force: true });
  const fixture = watcherFixture(t);
  assert.equal(fixture.watched, sessionsRoot);
});

function writeSession(id) {
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const filePath = path.join(sessionsRoot, `${id}.jsonl`);
  const timestamp = "2026-08-06T00:00:00.000Z";
  const entries = [
    { type: "session", version: 3, id, timestamp, cwd: fixtureRoot },
    {
      type: "message",
      id: `${id}-user`,
      parentId: null,
      timestamp,
      message: { role: "user", content: id, timestamp: Date.parse(timestamp) },
    },
  ];
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return filePath;
}

async function advance(t, milliseconds) {
  t.mock.timers.tick(milliseconds);
  await sessionIndex.flush();
  await new Promise((resolve) => setImmediate(resolve));
}

test("continuous changes publish within 1000 milliseconds instead of postponing forever", async (t) => {
  const filePath = writeSession("continuous");
  await sessionIndex.refreshPath(filePath);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const fixture = watcherFixture(t);
  fs.appendFileSync(
    filePath,
    `${JSON.stringify({ type: "session_info", id: "continuous-name", parentId: "continuous-user", timestamp: "2026-08-07T00:00:00.000Z", name: "updated" })}\n`,
  );
  for (let index = 0; index < 5; index += 1) {
    fixture.notify("continuous.jsonl");
    await advance(t, 200);
  }
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].session.name, "updated");
});

test("null filenames trigger at most one full reconcile per 5000 milliseconds without losing pending work", async (t) => {
  writeSession("unknown");
  await sessionIndex.refreshAll();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const fixture = watcherFixture(t);
  fixture.notify(null);
  await advance(t, 300);
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].fullRefresh, true);
  fixture.notify(null);
  await advance(t, 300);
  assert.equal(fixture.events.length, 1);
  await advance(t, 4699);
  assert.equal(fixture.events.length, 1);
  await advance(t, 1);
  assert.equal(fixture.events.length, 2);
  assert.equal(fixture.events[1].fullRefresh, true);
});

test("saved live messages use memory and are tagged live-append, while an external append is parsed", async (t) => {
  const filePath = writeSession("live");
  const manager = SessionManager.open(filePath);
  await sessionIndex.refreshPath(filePath);
  let announce;
  const inner = {
    sessionId: "live",
    sessionFile: filePath,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    agent: { state: {} },
    settingsManager: {},
    modelRuntime: { getModel: () => undefined },
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe(listener) {
      announce = listener;
      return () => {};
    },
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const wrapper = new AgentSessionWrapper(inner, { intents: new Map() });
  t.after(() => wrapper.destroy());
  wrapper.start();
  const fixture = watcherFixture(t);
  const message = { role: "user", content: "saved locally", timestamp: Date.parse("2026-08-07T00:00:00.000Z") };
  announce({ type: "message_end", message });
  manager.appendMessage(message);
  await new Promise((resolve) => setImmediate(resolve));
  let historyReads = 0;
  const openSync = fs.openSync;
  t.mock.method(fs, "openSync", (candidate, flags, ...args) => {
    if (flags === "r" && fs.realpathSync(candidate) === fs.realpathSync(filePath)) historyReads += 1;
    return openSync(candidate, flags, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  fixture.notify("live.jsonl");
  await advance(t, 300);
  assert.equal(fixture.events[0].cause, "live-append");
  assert.equal(fixture.events[0].session.messageCount, 2);
  assert.equal(historyReads, 0);
  fs.appendFileSync(
    filePath,
    `${JSON.stringify({ type: "session_info", id: "external-name", parentId: manager.getLeafId(), timestamp: "2026-08-08T00:00:00.000Z", name: "external" })}\n`,
  );
  fixture.notify("live.jsonl");
  await advance(t, 300);
  assert.equal(fixture.events[1].cause, "external");
  assert.equal(fixture.events[1].session.name, "external");
  assert.ok(historyReads > 0);
});

test("a failed watcher is rearmed and reconciles changes missed while disconnected", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const fixture = watcherFixture(t);
  fixture.watcher.emit("error", Object.assign(new Error("watch failed"), { code: "ENOSPC" }));
  writeSession("missed-during-watch-error");
  await advance(t, 999);
  assert.equal(fixture.watchCount(), 1);
  await advance(t, 1);
  assert.equal(fixture.watchCount(), 2);
  await advance(t, 300);
  assert.equal(sessionIndex.getById("missed-during-watch-error").messageCount, 1);
  assert.ok(fixture.events.some((event) => event.fullRefresh));
});

test("a saved hint cannot source an old file from a manager that switched sessions", async (t) => {
  const filePath = writeSession("before-switch");
  const manager = SessionManager.open(filePath);
  await sessionIndex.refreshPath(filePath);
  let announce;
  const inner = {
    sessionId: "before-switch",
    sessionFile: filePath,
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    agent: { state: {} },
    settingsManager: {},
    modelRuntime: { getModel: () => undefined },
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe(listener) {
      announce = listener;
      return () => {};
    },
  };
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const wrapper = new AgentSessionWrapper(inner, { intents: new Map() });
  t.after(() => wrapper.destroy());
  wrapper.start();
  const fixture = watcherFixture(t);
  const message = { role: "user", content: "last old message", timestamp: 1 };
  announce({ type: "message_end", message });
  manager.appendMessage(message);
  await new Promise((resolve) => setImmediate(resolve));
  manager.newSession();
  fixture.notify("before-switch.jsonl");
  await advance(t, 300);
  assert.equal(fixture.events[0].session.id, "before-switch");
  assert.equal(fixture.events[0].session.messageCount, 2);
  assert.equal(fixture.events[0].cause, "external");
});
