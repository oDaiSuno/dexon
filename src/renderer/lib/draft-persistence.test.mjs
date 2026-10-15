import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  DraftPersistenceController,
  flushDraft,
  getDraft,
  resetDraftCache,
  setDraft,
} from "../../shared/draft-store.ts";

function fixture(t) {
  const dom = new JSDOM("", { url: "http://localhost/" });
  const storage = dom.window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  resetDraftCache();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new DraftPersistenceController();
  t.after(() => {
    try {
      controller.dispose();
    } finally {
      resetDraftCache();
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else delete globalThis.localStorage;
      dom.window.close();
    }
  });
  // Read the durable browser record, not the controller's private state.
  const saved = (key) => JSON.parse(storage.getItem(`dexon-draft:${key}`));
  return { controller, storage, saved };
}

test("successive edits are readable immediately and only the latest draft is saved after 500ms of quiet", (t) => {
  const { controller, storage, saved } = fixture(t);
  storage.setItem("dexon-draft:session", JSON.stringify({ schemaVersion: 3, value: "previous", updatedAt: 1 }));

  controller.schedule("session", { value: "a" });
  assert.deepEqual(getDraft("session"), { value: "a" });
  t.mock.timers.tick(300);
  controller.schedule("session", { value: "ab" });
  assert.deepEqual(getDraft("session"), { value: "ab" });
  t.mock.timers.tick(499);
  assert.equal(saved("session").value, "previous", "editing has not replaced the saved draft yet");
  t.mock.timers.tick(1);
  assert.equal(saved("session").value, "ab");
});

test("switching draft owners saves the previous session without prematurely saving the new one", (t) => {
  const { controller, saved } = fixture(t);
  controller.schedule("old", { value: "old draft" });
  controller.schedule("new", { value: "new draft" });

  assert.equal(saved("old").value, "old draft");
  assert.equal(saved("new"), null);
  assert.deepEqual(getDraft("new"), { value: "new draft" });
  t.mock.timers.tick(500);
  assert.equal(saved("new").value, "new draft");
});

test("an explicit commit immediately saves the final edit instead of the pending draft", (t) => {
  const { controller, saved } = fixture(t);
  controller.schedule("session", { value: "pending" });
  assert.equal(controller.commit("session", { value: "latest" }), true);
  assert.equal(saved("session").value, "latest");
  t.mock.timers.tick(500);
  assert.equal(saved("session").value, "latest");
});

test("disposal preserves the pending draft before its debounce expires", (t) => {
  const { controller, saved } = fixture(t);
  controller.schedule("session", { value: "unfinished" });
  assert.equal(saved("session"), null);
  assert.equal(controller.dispose(), true);
  assert.equal(saved("session").value, "unfinished");
});

test("clearing a pending draft removes saved content and later clock advances cannot restore it", (t) => {
  const { controller, saved } = fixture(t);
  controller.commit("session", { value: "saved" });
  controller.schedule("session", { value: "pending" });
  assert.equal(controller.clear("session"), true);
  assert.equal(getDraft("session"), null);
  assert.equal(saved("session"), null);
  t.mock.timers.tick(1_000);
  assert.equal(saved("session"), null);
});

test("staging changes memory without replacing storage until an explicit flush", (t) => {
  const { saved } = fixture(t);
  setDraft("session", { value: "draft" });
  assert.deepEqual(getDraft("session"), { value: "draft" });
  assert.equal(saved("session"), null);
  assert.equal(flushDraft("session"), true);
  const stored = saved("session");
  // The persisted v3 record is a browser-facing compatibility contract.
  assert.equal(stored.schemaVersion, 3);
  assert.equal(stored.value, "draft");
  assert.equal("images" in stored, false);
  assert.equal("files" in stored, false);
  assert.equal(typeof stored.updatedAt, "number");
});

test("an in-memory empty draft hides stale saved text before its pending removal", (t) => {
  const { controller, storage, saved } = fixture(t);
  storage.setItem("dexon-draft:session", JSON.stringify({ schemaVersion: 3, value: "stale", updatedAt: 1 }));
  controller.schedule("session", { value: "" });
  assert.equal(getDraft("session"), null);
  assert.equal(saved("session").value, "stale");
  t.mock.timers.tick(500);
  assert.equal(saved("session"), null);
});
