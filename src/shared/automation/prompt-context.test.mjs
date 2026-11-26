import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_PROMPT_LIMITS,
  parseAutomationPromptBadge,
  parseAutomationPromptPayload,
} from "./prompt-context.ts";

test("automation prompt parsing accepts each mode and copies only bounded badge fields", () => {
  for (const mode of ["draft", "modify", "adjust"]) {
    const input = {
      badge: {
        mode,
        taskId: " daily-digest ",
        taskName: " Daily digest ",
        revision: 3,
        environmentLabel: " Local Mac ",
        hasUnsavedChanges: false,
        hiddenContext: "not a badge field",
        unexpected: { value: true },
      },
      hiddenContext: "  exact context\n",
      unexpected: true,
    };
    const parsed = parseAutomationPromptPayload(input);
    assert.deepEqual(parsed, {
      badge: {
        mode,
        taskId: "daily-digest",
        taskName: "Daily digest",
        revision: 3,
        environmentLabel: "Local Mac",
        hasUnsavedChanges: false,
      },
      hiddenContext: "  exact context\n",
    });
    assert.notEqual(parsed, input);
    assert.notEqual(parsed.badge, input.badge);
  }
});

test("invalid and oversized optional badge fields are discarded instead of rejecting a valid mode", () => {
  assert.deepEqual(
    parseAutomationPromptBadge({
      mode: "adjust",
      taskId: "x".repeat(AUTOMATION_PROMPT_LIMITS.taskId + 1),
      taskName: ["not text"],
      environmentLabel: "bad\u0000label",
      revision: Number.MAX_SAFE_INTEGER + 1,
      hasUnsavedChanges: "true",
    }),
    { mode: "adjust" },
  );
  for (const revision of [null, 0, -1, 1.5, Infinity, NaN, "3"]) {
    assert.deepEqual(parseAutomationPromptBadge({ mode: "modify", revision }), { mode: "modify" });
  }
  for (const field of ["taskId", "taskName", "environmentLabel"]) {
    const atLimit = "x".repeat(AUTOMATION_PROMPT_LIMITS[field]);
    assert.equal(parseAutomationPromptBadge({ mode: "draft", [field]: atLimit })[field], atLimit);
    assert.deepEqual(parseAutomationPromptBadge({ mode: "draft", [field]: atLimit + "x" }), { mode: "draft" });
    assert.deepEqual(parseAutomationPromptBadge({ mode: "draft", [field]: " \t " }), { mode: "draft" });
  }
});

test("missing modes and invalid or oversized hidden context never form an automation prompt", () => {
  for (const value of [null, undefined, false, [], "draft", {}, { mode: "create" }, { mode: ["draft"] }]) {
    assert.equal(parseAutomationPromptBadge(value), null);
    assert.equal(parseAutomationPromptPayload(value), null);
  }
  for (const hiddenContext of [
    undefined,
    null,
    [],
    {},
    1,
    "",
    " \n\t ",
    "x".repeat(AUTOMATION_PROMPT_LIMITS.hiddenContext + 1),
  ]) {
    assert.equal(parseAutomationPromptPayload({ badge: { mode: "draft" }, hiddenContext }), null);
  }
  const hiddenContext = "x".repeat(AUTOMATION_PROMPT_LIMITS.hiddenContext);
  assert.deepEqual(parseAutomationPromptPayload({ badge: { mode: "draft" }, hiddenContext }), {
    badge: { mode: "draft" },
    hiddenContext,
  });
});
