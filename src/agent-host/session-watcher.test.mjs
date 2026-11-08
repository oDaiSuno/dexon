import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as watchPolicy from "./session-watch-policy.ts";

const { classifySessionWatchChange } = watchPolicy;

test("session watcher refreshes exact session files and rejects traversal", () => {
  const agentDir = path.resolve("/agent");
  const sessionsRoot = path.join(agentDir, "sessions");
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "sessions/project/id.jsonl"), {
    kind: "refresh-path",
    path: path.join(sessionsRoot, "project", "id.jsonl"),
  });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "../outside.jsonl"), { kind: "ignore" });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "other/id.jsonl"), { kind: "ignore" });
});

test("ambiguous session metadata requests a full refresh while unrelated files are ignored", () => {
  const agentDir = path.resolve("/agent");
  const sessionsRoot = path.join(agentDir, "sessions");
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, null), { kind: "refresh-all" });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, Buffer.from("settings.json")), {
    kind: "refresh-all",
  });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "session-cache.tmp"), { kind: "refresh-all" });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "notes.txt"), { kind: "ignore" });
});

test("existing session directories and index state files do not trigger a full history scan", (t) => {
  const agentDir = mkdtempSync(path.join(tmpdir(), "pi-session-watch-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const sessionsRoot = path.join(agentDir, "sessions");
  const projectDir = path.join(sessionsRoot, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(path.join(projectDir, ".DS_Store"), "metadata");
  writeFileSync(path.join(agentDir, "session-index-cache.json"), "{}");

  for (const filename of [
    "sessions",
    "sessions/project",
    "sessions/project/.DS_Store",
    ".DS_Store",
    "session-index-cache.json",
    "desktop/session-index-cache.json",
    "desktop/session-index-cache.json.123.tmp",
    "desktop/session-projects.json",
    "sessions/project/session-cache.tmp",
  ]) {
    assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, filename), { kind: "ignore" }, filename);
  }

  rmSync(projectDir, { recursive: true });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "sessions/project"), { kind: "refresh-all" });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "sessions/project/nested"), {
    kind: "refresh-all",
  });
  rmSync(sessionsRoot, { recursive: true });
  assert.deepEqual(classifySessionWatchChange(agentDir, sessionsRoot, "sessions"), { kind: "refresh-all" });

  const missingAgentDir = path.join(agentDir, "not-watched");
  assert.deepEqual(
    classifySessionWatchChange(missingAgentDir, path.join(missingAgentDir, "sessions"), "sessions/project"),
    { kind: "ignore" },
  );
});

test("message appends preserve allowed roots while added, removed, or relocated sessions invalidate them", () => {
  const previous = { cwd: "/project/worktree", projectRoot: "/project", messageCount: 1 };
  assert.equal(
    watchPolicy.didSessionRootsChange?.(previous, { ...previous, messageCount: 2 }),
    false,
    "appending messages does not change allowed roots",
  );
  assert.equal(watchPolicy.didSessionRootsChange?.(null, previous), true, "a new session adds roots");
  assert.equal(watchPolicy.didSessionRootsChange?.(previous, null), true, "a deleted session removes roots");
  assert.equal(watchPolicy.didSessionRootsChange?.(null, null), true, "an unknown change requires a roots scan");
  assert.equal(watchPolicy.didSessionRootsChange?.(previous, { ...previous, cwd: "/other" }), true);
  assert.equal(watchPolicy.didSessionRootsChange?.(previous, { ...previous, projectRoot: "/other" }), true);
  assert.equal(watchPolicy.didSessionRootsChange?.({ cwd: "/project" }, { cwd: "/project", projectRoot: "" }), false);
});
