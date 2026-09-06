import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Phase 2 split SessionSidebar into responsibility modules; the timer-ownership
// guarantees now live with their actual owners.

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const directory = read("./session-sidebar/session-directory.ts");
const title = read("./session-sidebar/pi-agent-title.tsx");
const item = read("./session-sidebar/session-item.tsx");

test("the session directory owns refresh and deferred focus timers until unmount", () => {
  assert.match(directory, /if \(sessionRefreshTimerRef\.current\) clearTimeout\(sessionRefreshTimerRef\.current\)/);
  assert.match(directory, /sidebarMountedRef\.current = false/);
  assert.match(directory, /if \(!sidebarMountedRef\.current\) return/);
  assert.match(directory, /const deferredFocusTimers = deferredFocusTimersRef\.current/);
  assert.match(directory, /for \(const timer of deferredFocusTimers\) clearTimeout\(timer\)/);
});

test("dropdown focus requests go through the sidebar-owned deferred timer", () => {
  assert.doesNotMatch(
    read("./session-sidebar/project-picker.tsx"),
    /setTimeout\(\(\) => customPathInputRef\.current\?\.focus\(\), 0\)/,
  );
  assert.doesNotMatch(
    read("./session-sidebar/worktree-switcher.tsx"),
    /setTimeout\(\(\) => wtNewInputRef\.current\?\.focus\(\), 0\)/,
  );
});

test("title scramble and session item focus callbacks are cancelled on unmount", () => {
  assert.match(title, /if \(scrambleTimerRef\.current\) clearTimeout\(scrambleTimerRef\.current\)/);
  assert.match(
    item,
    /if \(restoreFocusFrameRef\.current !== null\) window\.cancelAnimationFrame\(restoreFocusFrameRef\.current\)/,
  );
  assert.match(item, /if \(selectInputTimerRef\.current\) clearTimeout\(selectInputTimerRef\.current\)/);
});
