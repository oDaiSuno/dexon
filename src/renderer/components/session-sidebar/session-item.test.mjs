import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createManualScheduler } from "#test-timing";
import {
  act,
  button,
  byRole,
  click,
  dom,
  hover,
  input,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
  waitFor,
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

const ROW_METHODS = new Set(["sessions.rename", "sessions.delete", "sessions.descendants"]);
const NO_DESCENDANTS = { sessionIds: [], runningSessionIds: [] };

function deleteRequests(view) {
  return view.env.requests.filter((request) => request.method === "sessions.delete");
}

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
  const env = {
    alertCalls: [],
    requests: [],
    reply: (method) => (method === "sessions.descendants" ? NO_DESCENDANTS : { ok: true }),
  };
  const originals = bindings.map(([owner, name]) => [owner, name, Object.getOwnPropertyDescriptor(owner, name)]);
  for (const [owner, name, value] of bindings)
    Object.defineProperty(owner, name, { configurable: true, writable: true, value });
  const boundary = installRendererApi(dom.window, api, () => ({
    call(method, params) {
      assert.ok(ROW_METHODS.has(method), `unexpected row request: ${method}`);
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
  await click(byRole(view.container, "menuitem", "Rename"));
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

test("a running session explains inside the confirmation that it must be stopped and cannot be deleted", async (t) => {
  const deleted = [];
  const view = await mountItem(t, { isRunning: true, onDeleted: (id) => deleted.push(id) });
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Delete session"));
  const confirm = byRole(view.container, "alertdialog", "Delete “Base session”?");
  assert.ok(confirm, "the confirmation card opens");
  assert.equal(byRole(confirm, "alert").textContent, "This session is still running. Stop it before deleting.");
  assert.equal(button(confirm, "Delete").disabled, true);
  assert.deepEqual(view.env.alertCalls, [], "no system dialog interrupts the user");
  assert.deepEqual(deleted, []);
  assert.deepEqual(deleteRequests(view), []);
});

test("confirms deletion and reports the deleted id", async (t) => {
  const deleted = [];
  let resolveDelete;
  const view = await mountItem(t, { onDeleted: (id) => deleted.push(id) });
  view.env.reply = (method) =>
    method === "sessions.descendants"
      ? NO_DESCENDANTS
      : new Promise((resolve) => {
          resolveDelete = resolve;
        });
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Delete session"));
  assert.match(view.container.textContent, /Delete this session\?/);
  await click(button(view.container, "Delete"));
  assert.deepEqual(deleteRequests(view), [{ method: "sessions.delete", params: { id: "s1" } }]);
  assert.deepEqual(deleted, []);
  await act(async () => resolveDelete({ ok: true }));
  assert.deepEqual(deleted, ["s1"]);
});

test("shows a delete failure inside the confirmation and keeps the row usable", async (t) => {
  const deleted = [];
  const view = await mountItem(t, { onDeleted: (id) => deleted.push(id) });
  view.env.reply = (method) => {
    if (method === "sessions.descendants") return NO_DESCENDANTS;
    throw new Error("denied");
  };
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Delete session"));
  await click(button(view.container, "Delete"));
  assert.deepEqual(deleted, []);
  assert.equal(byRole(view.container, "alert").textContent, "denied");
  assert.deepEqual(view.env.alertCalls, [], "no system dialog interrupts the user");
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

const SESSION_FILE = "/Users/me/.pi/agent/sessions/--workspace-dexon--/2026-07-15T12-00-00-000Z_s1.jsonl";

function stubClipboard(t, write) {
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: { writeText: write } });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
}

async function rightClick(element, clientX, clientY) {
  const event = new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
  await act(async () => element.dispatchEvent(event));
  return event;
}

async function openDeleteConfirm(view) {
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Delete session"));
  return byRole(view.container, "alertdialog", "Delete “Base session”?");
}

test("right-clicking a row opens the session menu at the pointer instead of the system menu", async (t) => {
  const actions = [];
  const view = await mountItem(t, { onClick: () => actions.push("select") });
  const event = await rightClick(button(view.container, "Base session"), 120, 200);
  assert.equal(event.defaultPrevented, true, "the system context menu does not appear");
  const menu = byRole(view.container, "menu", "Session actions");
  assert.ok(menu, "the session menu opens");
  assert.ok(byRole(menu, "menuitem", "Rename"));
  assert.ok(byRole(menu, "menuitem", "Delete session"));
  assert.equal(menu.style.position, "fixed");
  assert.equal(menu.style.left, "120px");
  assert.equal(menu.style.top, "200px");
  assert.deepEqual(actions, [], "opening the menu does not open the session");
});

test("Escape closes the right-click menu and leaves focus on the row's actions button", async (t) => {
  const view = await mountItem(t);
  await rightClick(button(view.container, "Base session"), 80, 60);
  await keyDown(byRole(view.container, "menuitem", "Rename"), "Escape");
  await flushBrowserWork(view);
  assert.equal(view.container.querySelector('[role="menu"]'), null);
  assert.equal(dom.window.document.activeElement, button(view.container, "Session actions for Base session"));
});

test("the actions button opens the menu under itself after a right-click menu was used", async (t) => {
  const view = await mountItem(t);
  await rightClick(button(view.container, "Base session"), 80, 60);
  await keyDown(byRole(view.container, "menuitem", "Rename"), "Escape");
  await flushBrowserWork(view);
  await click(button(view.container, "Session actions for Base session"));
  const menu = byRole(view.container, "menu", "Session actions");
  assert.ok(menu);
  assert.notEqual(menu.style.position, "fixed", "the menu drops down from the button, not from the old pointer spot");
});

test("copying the session path puts the full session file path on the clipboard and says so", async (t) => {
  let clipboard = "";
  stubClipboard(t, async (value) => {
    clipboard = value;
  });
  const view = await mountItem(t, { session: session("s1", { path: SESSION_FILE }) });
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Copy session path"));
  assert.equal(clipboard, SESSION_FILE);
  await waitFor(() => assert.ok(byRole(view.container, "menuitem", "Copied")));
});

test("a refused clipboard shows that copying the session path failed", async (t) => {
  stubClipboard(t, async () => {
    throw new Error("permission denied");
  });
  const view = await mountItem(t, { session: session("s1", { path: SESSION_FILE }) });
  await openActionsMenu(view);
  await click(byRole(view.container, "menuitem", "Copy session path"));
  await waitFor(() => assert.ok(byRole(view.container, "menuitem", "Copy failed")));
});

test("a session without children keeps the plain confirmation without a sub-session sentence", async (t) => {
  const view = await mountItem(t);
  const confirm = await openDeleteConfirm(view);
  await waitFor(() => assert.equal(button(confirm, "Delete").disabled, false));
  assert.doesNotMatch(confirm.textContent, /sub-session/);
});

test("deleting a session with sub-sessions says how many will go with it and deletes through one request", async (t) => {
  const deleted = [];
  const view = await mountItem(t, { onDeleted: (id) => deleted.push(id) });
  view.env.reply = (method) =>
    method === "sessions.descendants" ? { sessionIds: ["c1", "c2", "g1"], runningSessionIds: [] } : { ok: true };
  const confirm = await openDeleteConfirm(view);
  assert.deepEqual(
    view.env.requests.filter((request) => request.method === "sessions.descendants"),
    [{ method: "sessions.descendants", params: { id: "s1" } }],
  );
  await waitFor(() =>
    assert.match(
      confirm.textContent,
      /“Base session” and its 3 sub-sessions will be deleted together\. This can’t be undone\./,
    ),
  );
  await click(button(confirm, "Delete"));
  assert.deepEqual(deleteRequests(view), [{ method: "sessions.delete", params: { id: "s1" } }]);
  await waitFor(() => assert.deepEqual(deleted, ["s1"]));
});

test("a running sub-session blocks the deletion inside the confirmation", async (t) => {
  const view = await mountItem(t);
  view.env.reply = (method) =>
    method === "sessions.descendants" ? { sessionIds: ["c1", "c2"], runningSessionIds: ["c2"] } : { ok: true };
  const confirm = await openDeleteConfirm(view);
  await waitFor(() =>
    assert.equal(byRole(confirm, "alert")?.textContent, "A sub-session is still running. Stop it before deleting."),
  );
  assert.match(confirm.textContent, /its 2 sub-sessions will be deleted together/);
  assert.equal(button(confirm, "Delete").disabled, true);
  assert.deepEqual(deleteRequests(view), []);
});

test("the delete button waits until the sub-sessions are known", async (t) => {
  let answer;
  const view = await mountItem(t);
  view.env.reply = (method) =>
    method === "sessions.descendants"
      ? new Promise((resolve) => {
          answer = resolve;
        })
      : { ok: true };
  const confirm = await openDeleteConfirm(view);
  assert.equal(button(confirm, "Delete").disabled, true, "nothing can be deleted before its children are known");
  await act(async () => answer({ sessionIds: [], runningSessionIds: [] }));
  await waitFor(() => assert.equal(button(confirm, "Delete").disabled, false));
});

test("when the sub-sessions cannot be looked up the confirmation explains it and does not delete", async (t) => {
  const view = await mountItem(t);
  view.env.reply = (method) => {
    if (method === "sessions.descendants") throw new Error("lookup unavailable");
    return { ok: true };
  };
  const confirm = await openDeleteConfirm(view);
  await waitFor(() => assert.equal(byRole(confirm, "alert")?.textContent, "lookup unavailable"));
  assert.equal(button(confirm, "Delete").disabled, true);
  assert.deepEqual(deleteRequests(view), []);
});

test("the actions button stays out of sight until the row is pointed at or focused from the keyboard", async (t) => {
  const view = await mountItem(t);
  const summary = button(view.container, "Session actions for Base session");
  assert.equal(summary.style.opacity, "0", "an idle row shows no actions button");
  await act(async () => button(view.container, "Base session").focus());
  assert.equal(summary.style.opacity, "1", "keyboard focus on the row reveals the actions button");
  assert.equal(summary.style.pointerEvents, "auto");
  await act(async () => button(view.container, "Base session").blur());
  assert.equal(summary.style.opacity, "0", "leaving the row hides it again");
  await hover(view.container.querySelector('[role="listitem"]'));
  assert.equal(summary.style.opacity, "1", "pointing at the row reveals it");
});
