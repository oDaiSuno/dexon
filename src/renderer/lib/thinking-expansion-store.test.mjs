import assert from "node:assert/strict";
import test from "node:test";

import { ThinkingExpansionRegistry, ThinkingExpansionStore } from "./thinking-expansion-store.ts";

test("a block the reader never clicked has no choice of its own, and clicking one block leaves every other block alone", () => {
  const store = new ThinkingExpansionStore(5);
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  assert.equal(store.getSnapshot("entry-1:0"), undefined, "an untouched block leaves the default to its component");
  store.toggle("entry-1:0", true);
  assert.equal(store.getSnapshot("entry-1:0"), false, "clicking a block its component showed open leaves it closed");
  assert.equal(store.getSnapshot("entry-1:1"), undefined, "the next block of the same message keeps no choice");
  assert.equal(store.getSnapshot("entry-2:0"), undefined, "a block that shows up later keeps no choice either");
  assert.equal(updates, 1);
  unsubscribe();
  store.toggle("entry-1:0", false);
  assert.equal(store.getSnapshot("entry-1:0"), true, "clicking the same block again opens it");
  assert.equal(updates, 1, "unsubscribed readers receive no further updates");
});

test("a block dropped by the retention limit comes back with no choice, so its component shows its own default again", () => {
  const store = new ThinkingExpansionStore(2);
  store.toggle("old:0", false);
  store.toggle("other:0", false);
  store.getSnapshot("new:0");
  assert.equal(store.getSnapshot("old:0"), true, "reading a block nobody clicked keeps the choice the reader made");
  assert.equal(store.getSnapshot("other:0"), true, "both clicked blocks are still remembered");
  assert.equal(store.getSnapshot("new:0"), undefined, "reading a block records nothing");
  store.toggle("new:0", false);
  assert.equal(store.getSnapshot("old:0"), undefined, "the oldest choice was not retained");
});

test("sessions keep their own choices, and a session evicted or deleted comes back with no choice", () => {
  const registry = new ThinkingExpansionRegistry(2, 5);
  const first = registry.get("session-1");
  first.toggle("entry:0", false);
  const second = registry.get("session-2");
  assert.equal(second.getSnapshot("entry:0"), undefined, "another session's click is not this session's choice");
  second.toggle("entry:0", false);
  registry.get("session-3");
  assert.equal(first.getSnapshot("entry:0"), undefined, "eviction clears the previous reader's store");
  assert.equal(registry.get("session-1").getSnapshot("entry:0"), undefined);
  assert.equal(second.getSnapshot("entry:0"), undefined, "the next eviction clears session 2");
  const reopenedSecond = registry.get("session-2");
  assert.equal(reopenedSecond.getSnapshot("entry:0"), undefined, "a reopened session starts with no choices");
  reopenedSecond.toggle("entry:0", false);
  registry.delete("session-2");
  assert.equal(reopenedSecond.getSnapshot("entry:0"), undefined, "a deleted session keeps nothing");
  assert.equal(registry.get("session-2").getSnapshot("entry:0"), undefined);
});

test("when a message receives its saved id, the choices made under the temporary id move to the saved one", () => {
  const store = new ThinkingExpansionStore();
  store.toggle("live-1:0", false);
  store.toggle("live-1:2", true);
  store.toggle("live-2:0", false);
  let updates = 0;
  store.subscribe(() => updates++);
  store.adopt("live-1", "entry-abc");
  assert.equal(store.getSnapshot("entry-abc:0"), true, "the trace the reader opened follows the saved id");
  assert.equal(store.getSnapshot("entry-abc:2"), false, "the trace the reader closed follows the saved id");
  assert.equal(store.getSnapshot("live-1:0"), undefined, "nothing is left behind under the temporary id");
  assert.equal(store.getSnapshot("live-2:0"), true, "another message keeps its own choice");
  assert.equal(updates, 1, "readers hear about the move once");
  store.adopt("live-9", "entry-never");
  assert.equal(store.getSnapshot("entry-never:0"), undefined, "a message with no choices moves nothing");
  assert.equal(updates, 1, "a move with nothing to carry notifies nobody");
});
