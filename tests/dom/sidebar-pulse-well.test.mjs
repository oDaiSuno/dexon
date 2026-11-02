import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadRenderer, mount, click, byRole, restoreGlobals } from "../support/renderer.mjs";

const api = await loadRenderer(
  "sidebar-pulse-well",
  'export * from "./src/renderer/components/app-nav/recessed-pulse-well.tsx";',
);
after(restoreGlobals);
const session = (id) => ({
  id,
  name: `Task ${id}`,
  cwd: "/work/alpha",
  projectRoot: "/work/alpha",
  modified: "2026-09-01T00:00:00Z",
  created: "2026-09-01T00:00:00Z",
  messageCount: 1,
});
const row = (id, status = "running", extra = {}) => ({
  key: id,
  status,
  projectKey: "/work/alpha",
  projectName: "alpha",
  root: session(id),
  target: session(id),
  subagents: 0,
  runAge: { kind: "not-running" },
  sortTimestampMs: 0,
  ...extra,
});
const model = {
  rows: [row("root", "awaiting_input", { subagents: 2 })],
  sessionCounts: { awaiting_input: 2, error: 1, running: 0 },
  projectNames: ["alpha", "beta", "alpha"],
};
const props = (extra = {}) => ({ model, searching: false, selectedSessionId: null, onOpenSession() {}, ...extra });
function required(root, role, name) {
  const found = byRole(root, role, name);
  assert.ok(found, `Expected ${role} ${name}`);
  return found;
}

test("collapse keeps true counts and project names, search yields without rewriting the preference", async (t) => {
  api.setAppLanguage("en-US");
  const view = await mount(t, api.RecessedPulseWell, props());
  await click(required(view.container, "button", "Collapse active sessions"));
  let summary = required(view.container, "button", /2 waiting for your answer · 1 failed/);
  assert.match(summary.textContent, /2 wait · 1 error/);
  assert.match(summary.textContent, /alpha · beta/);
  assert.doesNotMatch(summary.textContent, /alpha · beta · alpha/);
  assert.equal(summary.style.height, "28px");
  assert.equal(summary.style.boxSizing, "border-box");
  assert.equal(summary.style.border, "1px solid var(--fx-status-warning-border)");
  assert.equal(summary.getAttribute("aria-disabled"), null);
  assert.equal(summary.style.cursor, "pointer");
  await view.update(props({ searching: true }));
  summary = required(view.container, "button", /2 waiting for your answer/);
  assert.equal(
    summary.getAttribute("aria-disabled"),
    "true",
    "search-yielded expansion announces that it is unavailable",
  );
  assert.equal(summary.style.cursor, "default");
  assert.match(summary.getAttribute("aria-description"), /2 waiting for your answer · 1 failed.*alpha · beta/);
  await click(summary);
  await view.update(props());
  assert.ok(byRole(view.container, "button", /2 waiting for your answer/));
  await click(required(view.container, "button", /2 waiting for your answer/));
  await view.update(props({ searching: true }));
  summary = required(view.container, "button", /2 waiting for your answer/);
  await click(summary);
  await view.update(props());
  required(view.container, "button", "Collapse active sessions");
});

test("overflow counts root tasks while the header counts sessions and rows open the urgent descendant", async (t) => {
  let opened = null;
  const many = {
    rows: [
      row("a", "awaiting_input", { subagents: 3, target: session("urgent-child") }),
      row("b", "error"),
      row("c"),
      row("d"),
      row("e"),
    ],
    sessionCounts: { awaiting_input: 2, error: 2, running: 4 },
    projectNames: ["alpha"],
  };
  const view = await mount(
    t,
    api.RecessedPulseWell,
    props({
      model: many,
      onOpenSession: (target) => {
        opened = target.id;
      },
    }),
  );
  assert.match(required(view.container, "button", "Collapse active sessions").textContent, /8/);
  assert.ok(!byRole(view.container, "button", /Task d/));
  const toggle = required(view.container, "button", "Show all active tasks");
  assert.match(toggle.textContent, /2 more background tasks/);
  assert.equal(toggle.style.height, "24px");
  await click(toggle);
  required(view.container, "button", /Task e/);
  await click(required(view.container, "button", /Task a/));
  assert.equal(opened, "urgent-child");
  await click(required(view.container, "button", "Show fewer active tasks"));
  assert.ok(!byRole(view.container, "button", /Task d/));
});

test("the pure face keeps session totals distinct from root rows and returns no face when idle", () => {
  assert.deepEqual(
    api.pulseWellFace(
      { rows: [], sessionCounts: { awaiting_input: 0, error: 0, running: 0 }, projectNames: [] },
      { preference: "expanded", searching: false, showAll: true },
    ),
    { kind: "hidden" },
  );
  const expanded = api.pulseWellFace(model, { preference: "expanded", searching: false, showAll: false });
  assert.equal(expanded.kind, "expanded");
  assert.equal(expanded.totalActiveSessions, 3);
  assert.equal(expanded.visibleRows.length, 1);
  const summary = api.pulseWellFace(model, { preference: "expanded", searching: true, showAll: false });
  assert.equal(summary.kind, "summary");
  assert.equal(summary.status, "awaiting_input");
  assert.equal(summary.yieldedForSearch, true);
});

test("running age distinguishes observed starts from approximate last activity and refreshes every fifteen seconds", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 120_000 });
  const ages = {
    rows: [
      row("observed", "running", { runAge: { kind: "observed", since: 0 } }),
      row("bootstrap", "running", { runAge: { kind: "unknown", fallbackModifiedMs: 0 } }),
      row("unknown", "running", { runAge: { kind: "unknown", fallbackModifiedMs: null } }),
    ],
    sessionCounts: { awaiting_input: 0, error: 0, running: 3 },
    projectNames: ["alpha"],
  };
  const view = await mount(t, api.RecessedPulseWell, props({ model: ages }));
  assert.match(required(view.container, "button", /Task observed/).textContent, /2m/);
  const approximate = required(view.container, "button", /Task bootstrap/);
  assert.match(approximate.textContent, /≈2m/);
  assert.ok(
    [...approximate.querySelectorAll("[title]")].some((element) =>
      /Last activity.*start.*unknown/i.test(element.title),
    ),
  );
  assert.match(required(view.container, "button", /Task unknown/).textContent, /Running/);
  const { act } = await import("../support/renderer.mjs");
  await act(async () => t.mock.timers.tick(60_000));
  assert.match(required(view.container, "button", /Task observed/).textContent, /3m/);
  await view.update(
    props({ model: { rows: [], sessionCounts: { awaiting_input: 0, error: 0, running: 0 }, projectNames: [] } }),
  );
  assert.equal(view.container.childElementCount, 0);
});

test("returning to a visible document refreshes run age immediately without waiting for a timer tick", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 120_000 });
  const { dom, act } = await import("../support/renderer.mjs");
  const document = dom.window.document;
  const original = Object.getOwnPropertyDescriptor(document, "visibilityState");
  t.after(() => {
    if (original) Object.defineProperty(document, "visibilityState", original);
    else delete document.visibilityState;
  });
  const visibility = async (value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
  };
  const running = {
    rows: [row("wake", "running", { runAge: { kind: "observed", since: 0 } })],
    sessionCounts: { awaiting_input: 0, error: 0, running: 1 },
    projectNames: ["alpha"],
  };
  const view = await mount(t, api.RecessedPulseWell, props({ model: running }));
  const task = () => required(view.container, "button", "alpha / Task wake · 1 running");
  assert.match(task().textContent, /2m/);
  await visibility("hidden");
  await act(async () => t.mock.timers.tick(600_000));
  assert.match(task().textContent, /2m/, "a hidden document has no clock updates");
  await visibility("visible");
  assert.match(task().textContent, /12m/, "foregrounding refreshes age before advancing any timer");
  await act(async () => t.mock.timers.tick(60_000));
  assert.match(task().textContent, /13m/);
  await click(required(view.container, "button", "Collapse active sessions"));
  await act(async () => t.mock.timers.tick(600_000));
  await click(required(view.container, "button", /Expand active sessions/));
  assert.match(task().textContent, /23m/, "expanding refreshes age immediately too");
});

test("the clock exists only for visible running rows and is released for collapse, search, idle and unmount", async (t) => {
  const intervals = new Map();
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay, ...args) => {
    const timer = originalSet(callback, delay, ...args);
    intervals.set(timer, delay);
    return timer;
  };
  globalThis.clearInterval = (timer) => {
    intervals.delete(timer);
    originalClear(timer);
  };
  t.after(() => {
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
  });
  const hiddenRunning = {
    rows: [
      row("a", "awaiting_input"),
      row("b", "error"),
      row("c", "error"),
      row("clock", "running", { runAge: { kind: "observed", since: 0 } }),
    ],
    sessionCounts: { awaiting_input: 1, error: 2, running: 1 },
    projectNames: ["alpha"],
  };
  const view = await mount(t, api.RecessedPulseWell, props({ model: hiddenRunning }));
  assert.equal(intervals.size, 0);
  await click(required(view.container, "button", "Show all active tasks"));
  assert.deepEqual([...intervals.values()], [15_000]);
  await click(required(view.container, "button", "Collapse active sessions"));
  assert.equal(intervals.size, 0);
  await click(required(view.container, "button", /Expand active sessions/));
  assert.equal(intervals.size, 1);
  await view.update(props({ model: hiddenRunning, searching: true }));
  assert.equal(intervals.size, 0);
  await view.update(props({ model: hiddenRunning }));
  assert.equal(intervals.size, 1);
  await view.update(
    props({ model: { rows: [], sessionCounts: { awaiting_input: 0, error: 0, running: 0 }, projectNames: [] } }),
  );
  assert.equal(intervals.size, 0);
  assert.equal(view.container.childElementCount, 0);
  await view.update(props({ model: hiddenRunning }));
  assert.equal(intervals.size, 1);
  const { dom, act } = await import("../support/renderer.mjs");
  const visibility = Object.getOwnPropertyDescriptor(dom.window.document, "visibilityState");
  t.after(() => {
    if (visibility) Object.defineProperty(dom.window.document, "visibilityState", visibility);
    else delete dom.window.document.visibilityState;
  });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
  assert.equal(intervals.size, 0);
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
  assert.equal(intervals.size, 1);
  await view.update(props({ model: hiddenRunning, visible: false }));
  assert.equal(intervals.size, 0);
  await view.update(props({ model: hiddenRunning }));
  assert.equal(intervals.size, 1);
  await view.unmount();
  assert.equal(intervals.size, 0);
});

test("Well row descriptions expose active sub-sessions and honest ages without changing button names", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 120_000 });
  const active = {
    rows: [
      row("observed", "running", { subagents: 2, runAge: { kind: "observed", since: 0 } }),
      row("approximate", "running", { runAge: { kind: "unknown", fallbackModifiedMs: 0 } }),
      row("unknown", "running", { runAge: { kind: "unknown", fallbackModifiedMs: null } }),
      row("waiting", "awaiting_input", { subagents: 3 }),
    ],
    sessionCounts: { awaiting_input: 1, error: 0, running: 3 },
    projectNames: ["alpha"],
  };
  const view = await mount(t, api.RecessedPulseWell, props({ model: active }));
  const description = (name) => required(view.container, "button", name).getAttribute("aria-description") ?? "";
  const observed = "alpha / Task observed · 1 running";
  assert.match(description(observed), /2 active sub-sessions/);
  assert.match(description(observed), /2m.*Time since this app observed the session start running/);
  assert.doesNotMatch(description(observed), /≈|unknown/);
  assert.match(description("alpha / Task approximate · 1 running"), /≈2m.*Last activity.*actual run start is unknown/);
  assert.match(description("alpha / Task unknown · 1 running"), /Running.*actual run start is unknown/i);
  assert.doesNotMatch(description("alpha / Task unknown · 1 running"), /≈|\dm/);
  await click(required(view.container, "button", "Show all active tasks"));
  assert.equal(description("alpha / Task waiting · 1 waiting for your answer"), "3 active sub-sessions");
  const { act } = await import("../support/renderer.mjs");
  await act(async () => api.setAppLanguage("zh-CN"));
  assert.match(
    description("alpha / Task observed · 1 个运行中"),
    /2 个活跃子会话.*2分钟.*从本应用观测到会话开始运行起计时/,
  );
  await act(async () => api.setAppLanguage("en-US"));
});

test("summary urgency uses waiting before error before running with the same shared tones", async (t) => {
  const view = await mount(t, api.RecessedPulseWell, props({ searching: true }));
  assert.equal(
    required(view.container, "button", /Expand active sessions/).style.border,
    "1px solid var(--fx-status-warning-border)",
  );
  await view.update(
    props({ searching: true, model: { ...model, sessionCounts: { awaiting_input: 0, error: 2, running: 1 } } }),
  );
  assert.equal(
    required(view.container, "button", /Expand active sessions/).style.border,
    "1px solid var(--fx-status-danger-border)",
  );
  await view.update(
    props({ searching: true, model: { ...model, sessionCounts: { awaiting_input: 0, error: 0, running: 3 } } }),
  );
  assert.equal(
    required(view.container, "button", /Expand active sessions/).style.border,
    "1px solid var(--fx-line-subtle)",
  );
});

test("Chinese summaries translate both compact counts and the full accessible description", async (t) => {
  api.setAppLanguage("zh-CN");
  const { act } = await import("../support/renderer.mjs");
  t.after(async () => act(async () => api.setAppLanguage("en-US")));
  const view = await mount(t, api.RecessedPulseWell, props({ searching: true }));
  const summary = required(view.container, "button", /展开活跃会话.*2 个等你回答.*1 个出错/);
  assert.match(summary.textContent, /2 待回答 · 1 出错/);
  assert.match(summary.textContent, /alpha · beta/);
});
