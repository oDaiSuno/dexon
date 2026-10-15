import assert from "node:assert/strict";
import test, { after } from "node:test";
import { dom, byRole, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
const { ChatWindow, resetRpc } = await loadRenderer(
  "chat-window-tool-card-behavior",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx";',
);
after(restoreGlobals);

test("a live interaction keeps its question and the chat textbox present without becoming a safety modal", async (t) => {
  const detail = createSessionDetail("card-session", {
    agentState: {
      running: false,
      state: {
        extensionUi: {
          runtimeId: "fixture-runtime",
          revision: 1,
          completed: [],
          requests: [
            {
              type: "extension_ui_request",
              id: "fixture-question",
              method: "confirm",
              title: "Confirm fixture operation",
              message: "Please decide",
            },
          ],
        },
      },
    },
  });
  const host = createSessionTestHost({ getSession: async () => detail });
  dom.window.piBridge = {};
  let view;
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, ChatWindow, {
    session: detail.info,
    newSessionCwd: null,
    onSessionCreated() {},
    onAgentEnd() {},
    onOpenFile() {},
  });
  const card = byRole(view.container, "region", "Tool interaction");
  const composer = view.container.querySelector('[role="textbox"]');
  assert.ok(card);
  assert.ok(composer);
  assert.match(card.textContent, /Confirm fixture operation/);
  assert.equal(view.container.querySelector('[aria-modal="true"]'), null);
});
