import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
const { reduceFileTabState } = await importTestBundle("src/renderer/lib/file-tab-state", {
  entryPoints: [path.join(import.meta.dirname, "file-tab-state.ts")],
});

test("identical paths on different servers remain independently selectable and closable", () => {
  const first = { id: "file:/same/path", label: "path", filePath: "/same/path", environmentId: "server-a" };
  const second = { ...first, environmentId: "server-b" };
  let state = reduceFileTabState({ tabs: [], activeTabId: "explorer" }, { type: "open", tab: first });
  state = reduceFileTabState(state, { type: "open", tab: second });
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].id, '["server-a","/same/path"]');
  assert.equal(state.tabs[1].id, '["server-b","/same/path"]');
  state = reduceFileTabState(state, { type: "select", tabId: state.tabs[0].id });
  assert.equal(state.activeTabId, '["server-a","/same/path"]');
  state = reduceFileTabState(state, { type: "close", tabId: state.tabs[1].id, fallbackTabId: "explorer" });
  assert.equal(state.tabs[0].environmentId, "server-a");
  assert.equal(state.activeTabId, '["server-a","/same/path"]');
});

const explorer = "explorer";
const tab = (id) => ({
  environmentId: "primary",
  id: `["primary","/tmp/${id}.txt"]`,
  label: `${id}.txt`,
  filePath: `/tmp/${id}.txt`,
});

test("consecutive closes reduce from the latest tabs and never select a closed id", () => {
  let state = { tabs: [tab("a"), tab("b"), tab("c")], activeTabId: tab("c").id };
  state = reduceFileTabState(state, { type: "close", tabId: tab("c").id, fallbackTabId: explorer });
  state = reduceFileTabState(state, { type: "close", tabId: tab("b").id, fallbackTabId: explorer });
  assert.deepEqual(state, { tabs: [tab("a")], activeTabId: tab("a").id });

  state = reduceFileTabState(state, { type: "close", tabId: tab("a").id, fallbackTabId: explorer });
  assert.deepEqual(state, { tabs: [], activeTabId: explorer });
});

test("closing an inactive tab preserves the active tab", () => {
  const state = { tabs: [tab("a"), tab("b")], activeTabId: tab("a").id };
  assert.deepEqual(reduceFileTabState(state, { type: "close", tabId: tab("b").id, fallbackTabId: explorer }), {
    tabs: [tab("a")],
    activeTabId: tab("a").id,
  });
});

test("opening selects a tab and refreshes its source session without duplicating it", () => {
  const initial = { tabs: [], activeTabId: explorer };
  const opened = reduceFileTabState(initial, {
    type: "open",
    tab: { ...tab("a"), sourceSessionId: "session-one" },
  });
  const reopened = reduceFileTabState(opened, {
    type: "open",
    tab: { ...tab("a"), sourceSessionId: "session-two" },
  });

  assert.deepEqual(reopened, {
    tabs: [{ ...tab("a"), sourceSessionId: "session-two" }],
    activeTabId: tab("a").id,
  });
});
