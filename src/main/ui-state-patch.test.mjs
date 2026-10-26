import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDesktopUiStatePatch } from "./ui-state-patch.ts";

test("renderer UI state accepts only complete, known appearance preferences", () => {
  assert.deepEqual(
    validateDesktopUiStatePatch({
      backgroundMode: false,
      managedProcessesEnabled: true,
      chatAppearance: { fontSize: "extra-large", layout: "wide" },
    }),
    {
      backgroundMode: false,
      managedProcessesEnabled: true,
      chatAppearance: { fontSize: "extra-large", layout: "wide" },
    },
  );

  for (const chatAppearance of [
    { fontSize: "large" },
    { layout: "wide" },
    { fontSize: "large", layout: "full" },
    { fontSize: "future", layout: "full" },
    null,
  ]) {
    assert.throws(() => validateDesktopUiStatePatch({ chatAppearance }), /Invalid chat appearance/);
  }
});

test("renderer UI state rejects unknown fields and malformed background mode", () => {
  assert.throws(() => validateDesktopUiStatePatch(null), /Invalid UI state patch/);
  assert.throws(() => validateDesktopUiStatePatch({ window: {} }), /Unsupported UI state field/);
  assert.throws(() => validateDesktopUiStatePatch({ backgroundMode: "yes" }), /must be a boolean/);
  assert.throws(() => validateDesktopUiStatePatch({ managedProcessesEnabled: "yes" }), /must be a boolean/);
});

test("renderer UI state accepts lastSpaceCwd only as an absolute path or null", () => {
  const absolute = path.join(tmpdir(), "tester", ".dexon");
  assert.deepEqual(validateDesktopUiStatePatch({ lastSpaceCwd: absolute }), { lastSpaceCwd: absolute });
  assert.deepEqual(validateDesktopUiStatePatch({ lastSpaceCwd: null }), { lastSpaceCwd: null });

  for (const bad of [42, {}, "relative/path", "has\0null", `/${"a".repeat(4096)}`]) {
    assert.throws(() => validateDesktopUiStatePatch({ lastSpaceCwd: bad }), /absolute directory path/);
  }

  // Unknown fields stay rejected alongside the new one.
  assert.throws(
    () => validateDesktopUiStatePatch({ lastSpaceCwd: absolute, recentCwds: [] }),
    /Unsupported UI state field/,
  );
});

test("renderer UI state accepts session collaboration settings only inside the documented range", () => {
  const settings = {
    enabled: true,
    maxRunning: 8,
    model: { provider: "held-fixture", modelId: "held-model" },
    thinkingLevel: "medium",
    allowUserSessions: false,
  };
  assert.deepEqual(validateDesktopUiStatePatch({ sessionOrchestration: settings }), { sessionOrchestration: settings });
  assert.deepEqual(
    validateDesktopUiStatePatch({
      sessionOrchestration: { ...settings, maxRunning: 1, model: null, thinkingLevel: null },
    }),
    { sessionOrchestration: { ...settings, maxRunning: 1, model: null, thinkingLevel: null } },
  );
  assert.deepEqual(validateDesktopUiStatePatch({ sessionOrchestration: { ...settings, maxRunning: 32 } }), {
    sessionOrchestration: { ...settings, maxRunning: 32 },
  });

  const rejected = [
    null,
    [],
    "enabled",
    8,
    { ...settings, enabled: "yes" },
    { ...settings, maxRunning: 0 },
    { ...settings, maxRunning: 33 },
    { ...settings, maxRunning: 2.5 },
    { ...settings, thinkingLevel: "extreme" },
    { ...settings, allowUserSessions: "yes" },
    { ...settings, model: { provider: "", modelId: "held-model" } },
    { ...settings, model: { provider: "held-fixture", modelId: "" } },
    { ...settings, model: { provider: "held-fixture" } },
  ];
  for (const sessionOrchestration of rejected) {
    assert.throws(
      () => validateDesktopUiStatePatch({ sessionOrchestration }),
      /session/i,
      `session collaboration settings should reject ${JSON.stringify(sessionOrchestration)}`,
    );
  }
});

test("renderer UI state accepts openProjects only as a list of distinct absolute folders", () => {
  const first = path.join(tmpdir(), "tester", ".dexon");
  const second = path.join(tmpdir(), "work", "project");
  assert.deepEqual(validateDesktopUiStatePatch({ openProjects: [first, second] }), {
    openProjects: [first, second],
  });
  assert.deepEqual(validateDesktopUiStatePatch({ openProjects: [] }), { openProjects: [] });

  for (const bad of [
    null,
    "not-a-list",
    {},
    [42],
    ["relative/path"],
    [`${first}\0`],
    [`${first}\n`],
    [`/${"a".repeat(4096)}`],
    [first, first],
  ]) {
    assert.throws(() => validateDesktopUiStatePatch({ openProjects: bad }), /Open projects/);
  }
});

test("renderer UI state rejects an openProjects list longer than 200 folders", () => {
  const folders = Array.from({ length: 201 }, (_, index) => path.join(tmpdir(), `project-${index}`));
  assert.throws(() => validateDesktopUiStatePatch({ openProjects: folders }), /Open projects/);
  assert.deepEqual(validateDesktopUiStatePatch({ openProjects: folders.slice(0, 200) }), {
    openProjects: folders.slice(0, 200),
  });
});
