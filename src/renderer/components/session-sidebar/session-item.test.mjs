import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createManualScheduler } from "#test-timing";
import {
  act,
  button,
  click,
  dom,
  hover,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../../../../tests/support/renderer.mjs";

import { installRendererApi } from "../../../../tests/support/renderer-api.mjs";
import { releaseAll } from "../../../../tests/support/cleanup.mjs";

after(restoreGlobals);
const api = await loadRenderer(
  "session-sidebar-session-item",
  'export { SessionItem } from "./src/renderer/components/session-sidebar/session-item.tsx";',
  // In Chromium these identifiers belong to the window. Keep JSDOM's own
  // Node-side selection notifications outside the component-owned clock.
  { define: { setTimeout: "window.setTimeout", clearTimeout: "window.clearTimeout" } },
);

function session(id, overrides = {}) {
  return {
    id,
    name: "Base session",
    firstMessage: "",
    cwd: "/workspace/dexon",
    modified: "2026-07-15T12:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

async function mountItem(t, props = {}) {
  const clock = createManualScheduler();
  const bindings = [
    [dom.window, "setTimeout", clock.setTimeout],
    [dom.window, "clearTimeout", clock.clearTimeout],
    [globalThis, "requestAnimationFrame", clock.requestAnimationFrame],
    [globalThis, "cancelAnimationFrame", clock.cancelAnimationFrame],
    [dom.window, "requestAnimationFrame", clock.requestAnimationFrame],
    [dom.window, "cancelAnimationFrame", clock.cancelAnimationFrame],
    [dom.window, "alert", (message) => env.alertCalls.push(message)],
  ];
  const env = { alertCalls: [], requests: [], reply: () => ({ ok: true }) };
  const originals = bindings.map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  for (const [owner, name, value] of bindings)
    Object.defineProperty(owner, name, { configurable: true, writable: true, value });
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      assert.ok(method === "sessions.rename" || method === "sessions.delete", `unexpected row request: ${method}`);
      env.requests.push({ method, params });
      return env.reply(method, params);
    },
  }));
  const view = await mount(
    t,
    api.SessionItem,
    { session: session("s1"), isSelected: false, onClick: () => {}, ...props },
    {
      release: () =>
        releaseAll(boundary.close, () => {
          for (const [owner, name, descriptor] of originals) {
            if (descriptor) Object.defineProperty(owner, name, descriptor);
            else delete owner[name];
          }
        }),
    },
  );
  return { ...view, env, clock, input: () => view.container.querySelector("input") };
}

async function flushBrowserWork(view) {
  await act(async () => {
    for (let pass = 0; view.clock.pendingCount() > 0; pass += 1) {
      if (pass >= 20) throw new Error("The row's browser work did not settle");
      await view.clock.runNext();
    }
  });
}

async function openActionsMenu(view) {
  await hover(view.container.querySelector('[role="listitem"]'));
  const summary = button(view.container, "Session actions for Base session");
  await click(summary);
  assert.ok(view.container.querySelector('[role="menu"]'));
  return summary;
}

async function startRename(view) {
  await openActionsMenu(view);
  await click(button(view.container, "Rename"));
  assert.ok(view.input(), "entering rename presents an input");
  return view.input();
}

test("commits a rename through the session API and notifies the parent", async (t) => {
  const renamed = [];
  const view = await mountItem(t, { onRenamed: () => renamed.push("renamed") });
  const field = await startRename(view);
  assert.equal(field.value, "Base session");
  await input(field, "Renamed session");
  await act(async () => field.blur());
  assert.equal(view.env.requests.length, 1);
  const request = view.env.requests[0];
  assert.deepEqual(request, { method: "sessions.rename", params: { id: "s1", name: "Renamed session" } });
  assert.deepEqual(renamed, ["renamed"]);
});

test("skips the rename request when the name is unchanged", async (t) => {
  const renamed = [];
  const view = await mountItem(t, { onRenamed: () => renamed.push("renamed") });
  const field = await startRename(view);
  await act(async () => field.blur());
  assert.deepEqual(renamed, []);
  assert.deepEqual(view.env.requests, []);
});

test("blocks deleting a running session behind an alert", async (t) => {
  const deleted = [];
  const view = await mountItem(t, { isRunning: true, onDeleted: (id) => deleted.push(id) });
  await openActionsMenu(view);
  await click(button(view.container, "Delete"));
  assert.equal(view.env.alertCalls.length, 1);
  assert.deepEqual(deleted, []);
  assert.deepEqual(view.env.requests, []);
  assert.doesNotMatch(view.container.textContent, /Delete “/);
});

test("confirms deletion and reports the deleted id", async (t) => {
  const deleted = [];
  let resolveDelete;
  const view = await mountItem(t, { onDeleted: (id) => deleted.push(id) });
  view.env.reply = () =>
    new Promise((resolve) => {
      resolveDelete = resolve;
    });
  await openActionsMenu(view);
  await click(button(view.container, "Delete"));
  assert.match(view.container.textContent, /Delete “/);
  await click(button(view.container, "Delete"));
  assert.equal(view.env.requests.length, 1);
  assert.deepEqual(view.env.requests[0], { method: "sessions.delete", params: { id: "s1" } });
  assert.deepEqual(deleted, []);
  await act(async () => resolveDelete({ ok: true }));
  assert.deepEqual(deleted, ["s1"]);
});

test("surfaces delete failures through an alert and keeps the row usable", async (t) => {
  const deleted = [];
  const view = await mountItem(t, { onDeleted: (id) => deleted.push(id) });
  view.env.reply = () => {
    throw new Error("denied");
  };
  await openActionsMenu(view);
  await click(button(view.container, "Delete"));
  await click(button(view.container, "Delete"));
  assert.deepEqual(deleted, []);
  assert.deepEqual(view.env.alertCalls, ["denied"]);
  assert.ok(button(view.container, "Base session"), "the row remains selectable after a failed delete");
});

test("toggles fork collapse from the row button without selecting the session", async (t) => {
  const actions = [];
  const view = await mountItem(t, {
    hasChildren: true,
    onToggleCollapse: () => actions.push("collapse"),
    onClick: () => actions.push("select"),
  });
  await click(button(view.container, "Collapse forks"));
  assert.deepEqual(actions, ["collapse"]);
});

test("Escape in the actions menu closes it and restores focus to its trigger", async (t) => {
  const view = await mountItem(t);
  const summary = await openActionsMenu(view);
  await keyDown(view.container.querySelector('[role="menuitem"]'), "Escape");
  await flushBrowserWork(view);
  assert.equal(view.container.querySelector('[role="menu"]'), null);
  assert.equal(dom.window.document.activeElement, summary);
});

test("entering rename focuses and selects the known existing name", async (t) => {
  const view = await mountItem(t);
  const field = await startRename(view);
  await flushBrowserWork(view);
  assert.equal(dom.window.document.activeElement, field);
  assert.equal(field.value, "Base session");
  assert.deepEqual([field.selectionStart, field.selectionEnd], [0, 12]);
});

test("unmounting during rename leaves no browser work or late focus change", async (t) => {
  const view = await mountItem(t);
  await startRename(view);
  await view.unmount();
  assert.equal(view.clock.pendingCount(), 0, "the unmounted row owns no remaining timers or frames");
  const following = dom.window.document.createElement("input");
  dom.window.document.body.appendChild(following);
  t.after(() => following.remove());
  following.focus();
  await flushBrowserWork(view);
  assert.equal(dom.window.document.activeElement, following);
  assert.deepEqual(view.env.requests, [], "disposing the editor is not a rename submission");
});
