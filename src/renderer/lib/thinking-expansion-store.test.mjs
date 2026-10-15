import assert from "node:assert/strict";
import test from "node:test";

import { ThinkingExpansionRegistry, ThinkingExpansionStore } from "./thinking-expansion-store.ts";

test("a thinking choice notifies readers but does not change already observed blocks", () => {
  const store = new ThinkingExpansionStore(5);
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  assert.equal(store.getSnapshot("entry-1:0"), false);
  assert.equal(store.getSnapshot("entry-untouched:0"), false);
  store.toggle("entry-1:0");
  assert.equal(store.getSnapshot("entry-1:0"), true);
  assert.equal(store.getSnapshot("entry-untouched:0"), false);
  assert.equal(store.getSnapshot("entry-2:0"), true, "newly observed blocks use the latest choice");
  assert.equal(updates, 1);
  unsubscribe();
  store.toggle("entry-1:0");
  assert.equal(updates, 1, "unsubscribed readers receive no further updates");
});

test("a block evicted by the retention limit uses the current default when revisited", () => {
  const store = new ThinkingExpansionStore(2);
  assert.equal(store.getSnapshot("old:0"), false);
  assert.equal(store.getSnapshot("other:0"), false);
  store.toggle("other:0");
  assert.equal(store.getSnapshot("new:0"), true);
  assert.equal(store.getSnapshot("old:0"), true, "the old collapsed choice was not retained");
});

test("sessions keep independent choices, while evicted and deleted sessions reopen collapsed", () => {
  const registry = new ThinkingExpansionRegistry(2, 5);
  const first = registry.get("session-1");
  first.toggle("entry:0");
  const second = registry.get("session-2");
  assert.equal(second.getSnapshot("entry:0"), false);
  second.toggle("entry:0");
  registry.get("session-3");
  assert.equal(first.getSnapshot("entry:0"), false, "eviction clears the previous reader's store");
  assert.equal(registry.get("session-1").getSnapshot("entry:0"), false);
  assert.equal(second.getSnapshot("entry:0"), false, "the next eviction clears session 2");
  const reopenedSecond = registry.get("session-2");
  reopenedSecond.toggle("entry:0");
  registry.delete("session-2");
  assert.equal(reopenedSecond.getSnapshot("entry:0"), false);
  assert.equal(registry.get("session-2").getSnapshot("entry:0"), false);
});
