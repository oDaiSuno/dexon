import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_DRAFT_SCHEMA_VERSION,
  CHAT_DRAFT_V2_SCHEMA_VERSION,
  DraftPersistenceController,
  clearDraft,
  flushDraft,
  getDraft,
  setDraft,
} from "./draft-store.ts";

function withMemoryStorage(t) {
  const previousStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  return values;
}

test("draft storage clones values, writes only on flush, and removes empty drafts", (t) => {
  const values = withMemoryStorage(t);

  const key = `owner-${Date.now()}`;
  setDraft(key, { value: "hello" });
  assert.equal(getDraft(key)?.value, "hello");
  assert.equal(values.size, 0);
  flushDraft(key);
  const stored = JSON.parse(values.values().next().value);
  assert.equal(stored.schemaVersion, CHAT_DRAFT_SCHEMA_VERSION);
  assert.equal(stored.value, "hello");
  clearDraft(key);
  assert.equal(values.size, 0);
});

test("v3 drafts never persist legacy attachment fields", (t) => {
  const values = withMemoryStorage(t);
  const key = `legacy-fields-${Date.now()}`;
  setDraft(key, { value: "text", images: [{ data: "YQ==", mimeType: "image/png" }], files: [] });
  flushDraft(key);
  const stored = JSON.parse(values.values().next().value);
  assert.equal("images" in stored, false);
  assert.equal("files" in stored, false);
});

test("loading a v2 draft surfaces legacy images and files for token migration", (t) => {
  const values = withMemoryStorage(t);

  const legacyKey = `legacy-${Date.now()}`;
  values.set(
    `dexon-draft:${legacyKey}`,
    JSON.stringify({
      schemaVersion: CHAT_DRAFT_V2_SCHEMA_VERSION,
      value: "legacy",
      images: [
        { data: "YQ==", mimeType: "image/png" },
        { data: 42, mimeType: "image/png" },
      ],
      files: [
        { name: "ok", path: "/tmp/ok.txt" },
        { name: "bad", path: "relative.txt" },
      ],
    }),
  );
  const draft = getDraft(legacyKey);
  assert.equal(draft?.value, "legacy");
  assert.deepEqual(draft?.images, [{ data: "YQ==", mimeType: "image/png" }]);
  assert.deepEqual(draft?.files, [{ name: "ok", path: "/tmp/ok.txt" }]);

  const futureKey = `future-${Date.now()}`;
  values.set(
    `dexon-draft:${futureKey}`,
    JSON.stringify({ schemaVersion: CHAT_DRAFT_SCHEMA_VERSION + 1, value: "future" }),
  );
  assert.equal(getDraft(futureKey), null);
});

test("draft controller flushes ownership on key changes and disposal", () => {
  const events = [];
  let scheduled;
  const controller = new DraftPersistenceController(500, {
    stage: (key) => events.push(`stage:${key}`),
    flush: (key) => events.push(`flush:${key}`),
    clear: (key) => events.push(`clear:${key}`),
    setTimer: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimer: () => events.push("cancel"),
  });
  controller.schedule("one", { value: "1" });
  controller.schedule("two", { value: "2" });
  scheduled();
  controller.dispose();
  assert.deepEqual(events, ["stage:one", "cancel", "flush:one", "stage:two", "flush:two"]);
});

test("draft controller reports persistence failures", () => {
  const errors = [];
  const controller = new DraftPersistenceController(
    500,
    {
      stage: () => {},
      flush: () => false,
      clear: () => false,
      setTimer: () => 1,
      clearTimer: () => {},
    },
    (key) => errors.push(key),
  );
  assert.equal(controller.commit("one", { value: "draft" }), false);
  assert.equal(controller.clear("two"), false);
  assert.deepEqual(errors, ["one", "two"]);
});
