import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Phase 2 split AppShell into responsibility modules; the clipboard rejection
// guarantee now lives with its actual owners: the session-info hook (state and
// copy handler) and the session-info popover (error alert).

const info = readFileSync(new URL("./app-shell/use-session-info.ts", import.meta.url), "utf8");
const popover = readFileSync(new URL("./app-shell/session-info-popover.tsx", import.meta.url), "utf8");

test("session clipboard rejection is consumed and exposed as local alert feedback", () => {
  assert.match(info, /copyText\(value\)[\s\S]*?\.catch\(\(\) => \{/);
  assert.match(info, /setSessionCopyFeedback\(\{ field, status: "error" \}\)/);
  assert.match(popover, /copyFeedback\?\.status === "error"/);
  assert.match(popover, /<div role="alert"/);
});
