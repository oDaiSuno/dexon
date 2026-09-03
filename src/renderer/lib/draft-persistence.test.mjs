import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CHAT_DRAFT_SCHEMA_VERSION,
  DraftPersistenceController,
  flushDraft,
  getDraft,
  setDraft,
} from "../../shared/draft-store.ts";

function fixture() {
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  const controller = new DraftPersistenceController(500, {
    stage: (key, draft) => calls.push(["stage", key, draft.value]),
    flush: (key) => calls.push(["flush", key]),
    clear: (key) => calls.push(["clear", key]),
    setTimer(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, callback);
      calls.push(["set-timer", id, delay]);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
      calls.push(["clear-timer", id]);
    },
  });
  return { calls, controller, timers };
}

test("draft writes debounce while memory receives every edit", () => {
  const { calls, controller, timers } = fixture();

  controller.schedule("session", { value: "a" });
  controller.schedule("session", { value: "ab" });

  assert.deepEqual(calls.slice(0, 4), [
    ["stage", "session", "a"],
    ["set-timer", 1, 500],
    ["stage", "session", "ab"],
    ["clear-timer", 1],
  ]);
  assert.equal(
    calls.some(([kind]) => kind === "flush"),
    false,
  );
  timers.get(2)();
  assert.deepEqual(calls.at(-1), ["flush", "session"]);
});

test("key switches, explicit commits, clears, and disposal flush pending ownership", () => {
  const { calls, controller } = fixture();

  controller.schedule("old", { value: "old draft" });
  controller.schedule("new", { value: "new draft" });
  controller.commit("new", { value: "latest" });
  controller.schedule("last", { value: "pending" });
  controller.dispose();
  controller.clear("last");

  assert.deepEqual(
    calls.filter(([kind]) => kind === "flush" || kind === "clear"),
    [
      ["flush", "old"],
      ["flush", "new"],
      ["flush", "last"],
      ["clear", "last"],
    ],
  );
});

test("staging a draft performs no synchronous localStorage write until flush", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const writes = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: (key) => writes.push(["remove", key]),
      setItem: (key, value) => writes.push(["set", key, value]),
    },
  });

  try {
    setDraft("debounce-proof", { value: "draft" });
    assert.deepEqual(writes, []);
    flushDraft("debounce-proof");
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], "set");
    const stored = JSON.parse(writes[0][2]);
    assert.equal(stored.schemaVersion, CHAT_DRAFT_SCHEMA_VERSION);
    assert.equal(stored.value, "draft");
    assert.equal("images" in stored, false);
    assert.equal("files" in stored, false);
    assert.equal(typeof stored.updatedAt, "number");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("an in-memory empty draft hides stale persisted content before debounce flush", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => JSON.stringify({ value: "stale" }),
      removeItem: () => {},
      setItem: () => {},
    },
  });

  try {
    setDraft("empty-tombstone", { value: "" });
    assert.equal(getDraft("empty-tombstone"), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("ChatInput schedules edits and commits exact refs on key switch and unmount", () => {
  const source = fs.readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

  assert.match(source, /draftPersistenceRef\.current\?\.schedule\(draftKey/);
  assert.match(source, /draftPersistenceRef\.current\?\.commit\(previousDraftKey/);
  assert.match(source, /draftPersistenceRef\.current\?\.commit\(currentDraftKey/);
  assert.match(source, /value: valueRef\.current,$/m);
  assert.match(source, /draftPersistenceRef\.current\?\.clear\(draftKey\)/);
  assert.match(source, /commitCurrentDraft\(\);\s*clearInput\(\)/);
});
