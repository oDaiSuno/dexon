import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatWindowSource = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatWindowHookSource = readFileSync(new URL("./chat-window/use-chat-window.tsx", import.meta.url), "utf8");
const chatWindowPropsSource = readFileSync(new URL("./chat-window/shared.ts", import.meta.url), "utf8");
const minimapSource = readFileSync(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const heightHookSource = readFileSync(new URL("../hooks/useObservedElementHeight.ts", import.meta.url), "utf8");
const composerSource = readFileSync(new URL("./chat-input/ComposerEditable.tsx", import.meta.url), "utf8");
const chatInputSource = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const toolDockSource = readFileSync(new URL("./interactive-tools/tool-card-dock.tsx", import.meta.url), "utf8");
const toolMotionSource = readFileSync(new URL("./interactive-tools/tool-motion.tsx", import.meta.url), "utf8");
const lifecycleSource = readFileSync(
  new URL("../hooks/agent-session/use-session-lifecycle.ts", import.meta.url),
  "utf8",
);
const mobileSource = readFileSync(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");
const controlsSource = readFileSync(new URL("./chat-input/use-composer-controls.ts", import.meta.url), "utf8");
const sessionControlsSource = readFileSync(new URL("./chat-input/SessionControls.tsx", import.meta.url), "utf8");
const dragDropSource = readFileSync(new URL("../hooks/useDragDrop.ts", import.meta.url), "utf8");
const historySource = readFileSync(new URL("../hooks/agent-session/use-session-history.ts", import.meta.url), "utf8");
const historyVisualSource = readFileSync(
  new URL("../hooks/agent-session/use-session-history-visuals.ts", import.meta.url),
  "utf8",
);
const eventsSource = readFileSync(new URL("../hooks/agent-session/use-session-events.ts", import.meta.url), "utf8");

// This test checks only the cross-component wiring. The real DOM behavior is
// covered by chat-input-visibility.test.mjs; this contract prevents future
// callers from silently dropping the visibility boundary.
test("ChatWindow exposes one explicit visibility boundary", () => {
  assert.match(chatWindowPropsSource, /visible\?:\s*boolean/);
  assert.match(chatWindowSource, /hidden=/);
  assert.match(chatWindowSource, /aria-hidden=/);
  assert.match(chatWindowSource, /inert=/);
  assert.match(chatWindowHookSource, /readingVisible:\s*visible/);
  assert.match(chatWindowHookSource, /<ChatInput[\s\S]*visible=\{visible\}/);
  assert.match(chatWindowSource, /<ChatMinimap[\s\S]*visible=\{visible\}/);
  assert.match(chatInputSource, /useIsMobile\(visible\)/);
  assert.match(chatWindowHookSource, /useIsMobile\(visible\)/);
});

test("hidden chat stops geometry and composer observation at their owners", () => {
  assert.match(heightHookSource, /enabled|visible/);
  assert.match(minimapSource, /visible/);
  assert.match(minimapSource, /disconnect/);
  assert.match(composerSource, /visible/);
  assert.match(composerSource, /selectionchange/);
  assert.match(toolDockSource, /visible\?: boolean/);
  assert.match(toolDockSource, /cancelAnimationFrame/);
  assert.match(toolMotionSource, /visible/);
  assert.match(lifecycleSource, /readingVisibleRef/);
  assert.match(lifecycleSource, /cancelAnimationFrame/);
  assert.match(mobileSource, /enabled = true/);
  assert.match(controlsSource, /focusFrameIdsRef/);
  assert.match(controlsSource, /cancelFocusFrames/);
  assert.match(sessionControlsSource, /visible: boolean/);
  assert.match(sessionControlsSource, /focusFrameIdsRef/);
  assert.match(dragDropSource, /enabled = true/);
  assert.match(chatWindowHookSource, /useDragDrop\(onDrop, visible\)/);
  assert.match(minimapSource, /pageVisible \?/);
  assert.match(historySource, /readingVisibleRef/);
  assert.match(historyVisualSource, /queueHistoryAnchor/);
  assert.match(eventsSource, /if \(!readingVisibleRef\.current\) break/);
});
