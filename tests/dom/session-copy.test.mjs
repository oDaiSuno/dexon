import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, createElement, button, click, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
const { useSessionInfo, SessionInfoPopover } = await loadRenderer(
  "session-copy-behavior",
  'export {useSessionInfo} from "./src/renderer/components/app-shell/use-session-info.ts"; export {SessionInfoPopover} from "./src/renderer/components/app-shell/session-info-popover.tsx";',
);
after(restoreGlobals);
const stats = {
  sessionId: "session-one",
  sessionFile: "/workspace/session.jsonl",
  userMessages: 1,
  assistantMessages: 1,
  toolCalls: 0,
  toolResults: 0,
  totalMessages: 2,
  cost: 0,
  tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
};
function SessionCard() {
  const state = useSessionInfo();
  return createElement(SessionInfoPopover, {
    sessionStats: stats,
    contextUsage: null,
    copyFeedback: state.sessionCopyFeedback,
    onCopyField: state.handleCopySessionField,
    isMobile: false,
  });
}

test("a rejected clipboard copy appears as a local alert and a successful retry clears it", async (t) => {
  let accepted = false;
  let clipboard = "";
  const original = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: {
      async writeText(value) {
        if (!accepted) throw new Error("permission denied");
        clipboard = value;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(dom.window.navigator, "clipboard", original);
    else delete dom.window.navigator.clipboard;
  });
  const view = await mount(t, SessionCard);
  await click(button(view.container, "Copy session ID"));
  assert.match(view.container.querySelector('[role="alert"]').textContent, /Check clipboard permission/);
  assert.equal(clipboard, "");
  accepted = true;
  await click(button(view.container, "Copy failed"));
  assert.equal(clipboard, "session-one");
  assert.equal(view.container.querySelector('[role="alert"]'), null);
  assert.ok(button(view.container, "Copied"));
});
