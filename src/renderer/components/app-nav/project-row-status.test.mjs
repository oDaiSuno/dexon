import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  button,
  byRole,
  createElement,
  dom,
  hover,
  loadRenderer,
  mount,
  restoreGlobals,
  text,
} from "../../../../tests/support/renderer.mjs";
import { accessibleName } from "../../../../tests/support/dom-queries.mjs";

after(restoreGlobals);
const { ProjectRow, projectRowFace, setAppLanguage } = await loadRenderer(
  "project-row-status",
  'export { ProjectRow } from "./src/renderer/components/app-nav/project-row.tsx";' +
    'export { projectRowFace } from "./src/renderer/components/app-nav/project-row-status.tsx";',
);

function props(face, overrides = {}) {
  return {
    name: "alpha-api",
    path: "/work/alpha-api",
    count: 14,
    countLabel: "14 sessions",
    open: false,
    current: false,
    face,
    onToggle: () => {},
    actions: (revealed) =>
      createElement(
        "button",
        { "aria-label": "More", style: { opacity: revealed ? 1 : 0, width: 24, height: 24 } },
        "⋯",
      ),
    ...overrides,
  };
}

function description(control) {
  return (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => dom.window.document.getElementById(id)?.textContent.trim() ?? "")
    .join(" ")
    .trim();
}

test("an unread project shows its dot and total, then preserves the dot left of More on hover and focus", async (t) => {
  const view = await mount(t, ProjectRow, props({ kind: "closed-unread", totalSessions: 14, unreadCount: 2 }));
  const row = byRole(view.container, "listitem");
  const toggle = button(row, "alpha-api");
  assert.equal(accessibleName(toggle), "alpha-api");
  assert.equal(description(toggle), "14 sessions 2 unread");
  const dot = row.querySelector('[data-activity="unread"]');
  assert.ok(dot, "the unread dot is visible at rest");
  assert.equal(dot.style.width, "6px");
  assert.equal(dot.style.height, "6px");
  assert.equal(text(toggle, "14").getAttribute("aria-hidden"), "true");
  assert.equal(text(toggle, "14").style.opacity, "1");
  await hover(row);
  assert.equal(dot.isConnected, true);
  assert.equal(text(toggle, "14").style.opacity, "0");
  assert.equal(dot.parentElement.style.paddingRight, "28px");
  await act(async () =>
    row.dispatchEvent(
      new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: dom.window.document.body }),
    ),
  );
  await act(async () => toggle.focus());
  assert.equal(text(toggle, "14").style.opacity, "0");
  assert.equal(dot.parentElement.style.paddingRight, "28px");
  assert.equal(button(row, "More").style.opacity, "1");
});

const mixedActivity = {
  sessionCounts: { awaiting_input: 2, error: 3, running: 4 },
  taskCounts: { awaiting_input: 1, error: 1, running: 1 },
  unread: 5,
  workInFlight: true,
};

test("open project faces never bubble live or unread activity and missing always wins without numeric fields", () => {
  assert.deepEqual(projectRowFace({ open: true, missing: false, totalSessions: 14, activity: mixedActivity }), {
    kind: "open",
    totalSessions: 14,
  });
  assert.deepEqual(projectRowFace({ open: false, missing: true, totalSessions: 14, activity: mixedActivity }), {
    kind: "missing",
  });
  assert.deepEqual(projectRowFace({ open: true, missing: true, totalSessions: 14, activity: mixedActivity }), {
    kind: "missing",
  });
  assert.deepEqual(projectRowFace({ open: false, missing: false, totalSessions: 14, activity: mixedActivity }), {
    kind: "closed-live",
    status: "awaiting_input",
    count: 2,
    totalSessions: 14,
  });
});

for (const kind of ["open", "closed-quiet"]) {
  test(`${kind} shows only the total at rest and hides it for More on hover and focus`, async (t) => {
    const view = await mount(t, ProjectRow, props({ kind, totalSessions: 14 }, { open: kind === "open" }));
    const row = byRole(view.container, "listitem");
    const toggle = button(row, "alpha-api");
    assert.equal(accessibleName(toggle), "alpha-api");
    assert.equal(description(toggle), "14 sessions");
    assert.equal(row.querySelector("[data-activity]"), null);
    assert.equal(text(toggle, "14").style.opacity, "1");
    assert.equal(text(toggle, "alpha-api").className, "type-body-large");
    await hover(row);
    assert.equal(text(toggle, "14").style.opacity, "0");
    assert.equal(button(row, "More").style.opacity, "1");
    await act(async () =>
      row.dispatchEvent(
        new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: dom.window.document.body }),
      ),
    );
    assert.equal(text(toggle, "14").style.opacity, "1");
    await act(async () => toggle.focus());
    assert.equal(text(toggle, "14").style.opacity, "0");
  });
}

for (const [status, phrase, iconSize, height, color] of [
  ["awaiting_input", "2 waiting for your answer", "11", "19px", "var(--fx-status-warning)"],
  ["error", "2 failed", "11", "19px", "var(--fx-status-danger)"],
  ["running", "2 running", "13", "20px", "var(--fx-accent-blue-text)"],
]) {
  test(`closed ${status} keeps its live count and glyph left of More at rest, hover and focus`, async (t) => {
    const face = projectRowFace({
      open: false,
      missing: false,
      totalSessions: 14,
      activity: { ...mixedActivity, sessionCounts: { awaiting_input: 0, error: 0, running: 0, [status]: 2 } },
    });
    const view = await mount(t, ProjectRow, props(face));
    const row = byRole(view.container, "listitem");
    const toggle = button(row, "alpha-api");
    assert.equal(accessibleName(toggle), "alpha-api");
    assert.equal(description(toggle), `14 sessions ${phrase}`);
    assert.equal(text(toggle, "14"), undefined);
    assert.equal(text(toggle, "alpha-api").className, "type-body-large-medium");
    const badge = row.querySelector(`[data-activity="${status}"]`);
    assert.ok(badge);
    assert.equal(badge.style.height, height);
    assert.equal(badge.querySelector("svg").getAttribute("width"), iconSize);
    assert.equal(badge.querySelector("svg").parentElement.style.color, color);
    assert.equal(text(badge, "2").getAttribute("aria-hidden"), "true");
    if (status === "running") assert.ok(badge.querySelector(".session-status-spin"));
    else {
      assert.equal(badge.style.padding, "1px 6px 1px 5px");
      assert.match(badge.style.border, /1px solid/);
    }
    await hover(row);
    assert.equal(badge.isConnected, true);
    assert.equal(badge.parentElement.style.paddingRight, "28px");
    assert.equal(button(row, "More").style.opacity, "1");
    await act(async () =>
      row.dispatchEvent(
        new dom.window.MouseEvent("mouseout", { bubbles: true, relatedTarget: dom.window.document.body }),
      ),
    );
    assert.equal(badge.parentElement.style.paddingRight, "0px");
    await act(async () => toggle.focus());
    assert.equal(badge.isConnected, true);
    assert.equal(badge.parentElement.style.paddingRight, "28px");
  });
}

test("missing rows contain zero digits at rest and hover even when activity is live", async (t) => {
  const face = projectRowFace({ open: false, missing: true, totalSessions: 14, activity: mixedActivity });
  const view = await mount(t, ProjectRow, props(face, { missing: true, missingLabel: "Folder not found" }));
  const row = byRole(view.container, "listitem");
  const toggle = button(row, "alpha-api");
  assert.equal(accessibleName(toggle), "alpha-api");
  assert.match(row.textContent, /Folder not found/);
  assert.doesNotMatch(row.textContent, /\d/);
  assert.equal(toggle.getAttribute("aria-describedby"), null);
  assert.equal(row.querySelector("[data-activity]"), null);
  await hover(row);
  assert.doesNotMatch(row.textContent, /\d/);
  assert.equal(button(row, "More").style.opacity, "1");
});

test("dragging retains the project name and existing raised row treatment", async (t) => {
  const view = await mount(t, ProjectRow, props({ kind: "closed-quiet", totalSessions: 14 }, { dragging: true }));
  const row = byRole(view.container, "listitem");
  assert.equal(accessibleName(button(row, "alpha-api")), "alpha-api");
  assert.equal(row.style.background, "var(--fx-surface-raised)");
  assert.equal(row.style.borderRadius, "var(--radius-control)");
  assert.equal(button(row, "alpha-api").style.height, "32px");
});

test("unread and live descriptions are translated without changing the exact project name", async (t) => {
  await act(async () => setAppLanguage("zh-CN"));
  try {
    const view = await mount(
      t,
      ProjectRow,
      props({ kind: "closed-unread", totalSessions: 14, unreadCount: 2 }, { countLabel: "14 个会话" }),
    );
    const toggle = button(view.container, "alpha-api");
    assert.equal(description(toggle), "14 个会话 2 个未读");
    await view.update(
      props(
        { kind: "closed-live", status: "awaiting_input", count: 2, totalSessions: 14 },
        { countLabel: "14 个会话" },
      ),
    );
    assert.equal(description(toggle), "14 个会话 2 个等你回答");
    assert.equal(accessibleName(toggle), "alpha-api");
  } finally {
    await act(async () => setAppLanguage("en-US"));
  }
});
