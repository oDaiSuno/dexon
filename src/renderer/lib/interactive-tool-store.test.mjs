import assert from "node:assert/strict";
import test from "node:test";
import { importTestBundle } from "#test-bundle";
const { InteractiveToolStore, isPendingCard } = await importTestBundle("interactive-tool-store", {
  entryPoints: ["src/renderer/lib/interactive-tool-store.ts"],
  packages: "external",
  tsconfig: "tsconfig.renderer.json",
});
const question = {
  question: "Choose?",
  header: "Choice",
  options: [
    { label: "One", description: "First" },
    { label: "Two", description: "Second" },
  ],
};
const request = (id, method = "questionnaire") => ({
  type: "extension_ui_request",
  id,
  method,
  questions: [question, question],
  lines: ["initial"],
  title: "Title",
});
const snapshot = (requests, revision = 1, runtimeId = "host-1", completed = []) => ({
  runtimeId,
  revision,
  requests,
  completed,
});
function memory() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
const first = (store) => store.getSnapshot().entries[0];

test("collapse and reopen three times preserves answers and sends no commands", () => {
  const commands = [];
  const store = new InteractiveToolStore("A", async (_, c) => {
    commands.push(c);
  });
  store.reconcile(snapshot([request("q")]));
  store.updateDraft("q", (d) => ({
    ...d,
    questionIndex: 1,
    answers: [
      { selected: [0], text: "" },
      { selected: [1], text: "note" },
    ],
  }));
  const saved = first(store).draft;
  for (let i = 0; i < 3; i++) {
    store.setCollapsed("q", true);
    store.setCollapsed("q", false);
    assert.deepEqual(first(store).draft, saved);
  }
  assert.deepEqual(commands, []);
});

test("three mixed requests retain arrival order and count down exactly once", async () => {
  const store = new InteractiveToolStore("A", async (_, c) => ({ id: c.id, status: "submitted" }));
  const requests = [request("a", "input"), request("b"), request("c", "custom")];
  store.reconcile(snapshot(requests));
  store.updateDraft("b", (d) => ({ ...d, value: "preserved" }));
  store.reconcile(snapshot(requests, 2));
  assert.equal(store.getSnapshot().entries[1].draft.value, "preserved");
  for (const [i, req] of requests.entries()) {
    const active = store.getSnapshot().entries.filter(isPendingCard);
    assert.equal(active.length, 3 - i);
    assert.equal(active[0].request.id, req.id);
    await store.respond(req.id, { value: "answer" });
  }
  assert.equal(store.getSnapshot().entries.filter(isPendingCard).length, 0);
});

test("in-flight delivery and double click keep the card until confirmation", async () => {
  const delivery = Promise.withResolvers();
  let calls = 0;
  const store = new InteractiveToolStore("A", () => {
    calls++;
    return delivery.promise;
  });
  store.reconcile(snapshot([request("q")]));
  const sending = store.respond("q", { value: "answer" });
  assert.equal(first(store).status, "sending");
  await store.respond("q", { cancelled: true });
  assert.equal(calls, 1);
  delivery.resolve({ id: "q", status: "submitted" });
  await sending;
  assert.equal(first(store).status, "submitted");
});

test("failed delivery preserves drafts and permits a successful retry", async () => {
  const delivery = Promise.withResolvers();
  let calls = 0;
  const store = new InteractiveToolStore("A", () =>
    ++calls === 1 ? delivery.promise : Promise.resolve({ id: "q", status: "submitted" }),
  );
  store.reconcile(snapshot([request("q")]));
  store.updateDraft("q", (d) => ({ ...d, value: "not lost" }));
  const sending = store.respond("q", { value: "not lost" });
  delivery.reject(new Error("Simulated response delivery failure"));
  await sending;
  assert.equal(first(store).status, "failed");
  assert.equal(first(store).draft.value, "not lost");
  await store.respond("q", { value: "not lost" });
  assert.equal(first(store).status, "submitted");
});

test("switches, page remounts and renderer reloads restore only host-verified drafts", () => {
  const storage = memory();
  const a = new InteractiveToolStore("A", async () => {}, storage);
  a.reconcile(snapshot([request("q")]));
  a.updateDraft("q", (d) => ({ ...d, value: "A draft", collapsed: true, questionIndex: 1 }));
  const b = new InteractiveToolStore("B", async () => {}, storage);
  b.reconcile(snapshot([request("q")]));
  assert.equal(first(b).draft.value, "");
  for (let i = 0; i < 3; i++) {
    const restored = new InteractiveToolStore("A", async () => {}, storage);
    assert.equal(restored.getSnapshot().entries.length, 0, "saved data cannot authorize a request");
    restored.reconcile(snapshot([request("q")]));
    assert.deepEqual(first(restored).draft, first(a).draft);
  }
  const restarted = new InteractiveToolStore("A", async () => {}, storage);
  restarted.reconcile(snapshot([request("q")], 0, "host-2"));
  assert.equal(first(restarted).draft.value, "");
});

test("backend restart expires pending cards and rejects old runtime replay", () => {
  const store = new InteractiveToolStore("A", async () => {});
  store.reconcile(snapshot([request("q")]));
  store.reconcile(snapshot([], 0, "host-2"));
  assert.equal(first(store).status, "expired");
  store.reconcile(snapshot([request("q")], 20));
  assert.equal(first(store).status, "expired");
});

test("out of order snapshots cannot resurrect a closed request", () => {
  const store = new InteractiveToolStore("A", async () => {});
  store.reconcile(snapshot([request("q")]));
  store.reconcile(snapshot([], 3, "host-1", [{ id: "q", status: "submitted" }]));
  store.reconcile(snapshot([request("q")], 2));
  assert.equal(first(store).status, "submitted");
});

test("a missing acknowledgement cannot overwrite authoritative completion", async () => {
  const delivery = Promise.withResolvers();
  const store = new InteractiveToolStore("A", () => delivery.promise);
  store.reconcile(snapshot([request("q")]));
  const sending = store.respond("q", { value: "answer" });
  store.reconcile(snapshot([], 2, "host-1", [{ id: "q", status: "submitted" }]));
  delivery.reject(new Error("lost acknowledgement"));
  await sending;
  assert.equal(first(store).status, "submitted");
});

test("late delivery for session A cannot clear session B", async () => {
  const delivery = Promise.withResolvers();
  const a = new InteractiveToolStore("A", () => delivery.promise);
  const b = new InteractiveToolStore("B", async () => {});
  a.reconcile(snapshot([request("same")]));
  b.reconcile(snapshot([request("same")]));
  const sending = a.respond("same", { value: "A" });
  delivery.resolve({ id: "same", status: "submitted" });
  await sending;
  assert.equal(first(b).status, "pending");
});

test("custom render updates do not reopen collapsed content", () => {
  const store = new InteractiveToolStore("A", async () => {});
  store.reconcile(snapshot([request("c", "custom")]));
  store.setCollapsed("c", true);
  store.reconcile(snapshot([{ ...request("c", "custom"), lines: ["new frame"] }], 2));
  assert.equal(first(store).draft.collapsed, true);
  assert.deepEqual(first(store).request.lines, ["new frame"]);
});

test("corrupted or unavailable draft storage cannot block answering", () => {
  const storage = {
    getItem: () => "broken JSON",
    setItem: () => {
      throw new Error("denied");
    },
    removeItem() {},
  };
  const store = new InteractiveToolStore("A", async () => {}, storage);
  store.reconcile(snapshot([request("q")]));
  assert.equal(first(store).status, "pending");
  assert.equal(store.getSnapshot().storageFailed, true);
});

test("a renderer reload after host shutdown reports expired drafts without reviving them", () => {
  const storage = memory();
  const before = new InteractiveToolStore("A", async () => {}, storage);
  before.reconcile(snapshot([request("q")]));
  before.updateDraft("q", (d) => ({ ...d, value: "stale text" }));
  const reloaded = new InteractiveToolStore("A", async () => {}, storage);
  reloaded.reconcile(null);
  assert.equal(reloaded.getSnapshot().entries.length, 0);
  assert.equal(reloaded.getSnapshot().expiredDraft, true);
  reloaded.dismissExpiredDraft();
  assert.equal(reloaded.getSnapshot().expiredDraft, false);
  const again = new InteractiveToolStore("A", async () => {}, storage);
  again.reconcile(null);
  assert.ok(!again.getSnapshot().expiredDraft);
});

test("late custom-input failures do not resurrect an ended panel", async () => {
  const delivery = Promise.withResolvers();
  const started = Promise.withResolvers();
  const store = new InteractiveToolStore("A", () => {
    started.resolve();
    return delivery.promise;
  });
  store.reconcile(snapshot([request("c", "custom")]));
  store.input("c", "\r");
  await started.promise;
  store.reconcile(snapshot([], 2, "host-1", [{ id: "c", status: "completed" }]));
  delivery.reject(new Error("connection lost after completion"));
  await delivery.promise.catch(() => {});
  await Promise.resolve();
  assert.equal(first(store).status, "completed");
});

test("queued old-runtime replay cannot revive a saved draft after verified shutdown", () => {
  const storage = memory();
  const before = new InteractiveToolStore("A", async () => {}, storage);
  before.reconcile(snapshot([request("q")]));
  const reload = new InteractiveToolStore("A", async () => {}, storage);
  reload.reconcile(null);
  reload.reconcile(snapshot([request("q")], 100));
  assert.equal(reload.getSnapshot().entries.length, 0);
  assert.equal(reload.getSnapshot().expiredDraft, true);
});

test("a request expiring while the renderer is absent produces an explicit stale-draft notice", () => {
  const storage = memory();
  const before = new InteractiveToolStore("A", async () => {}, storage);
  before.reconcile(snapshot([request("q")]));
  const restored = new InteractiveToolStore("A", async () => {}, storage);
  restored.reconcile(snapshot([], 2, "host-1", [{ id: "q", status: "expired", reason: "timeout" }]));
  assert.equal(restored.getSnapshot().entries.length, 0);
  assert.equal(restored.getSnapshot().expiredDraft, true);
});
