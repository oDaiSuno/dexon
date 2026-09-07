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
