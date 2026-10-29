import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { assistantReply, textBlock, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "queued-question-saved-id",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const QUEUED = "顺便看一下 src/main.ts 有没有问题。";

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function emit(host, event) {
  await act(async () => {
    for (const sink of host.eventSinks.filter((candidate) => candidate.active)) sink.onEvent(event);
  });
  await settle();
}

async function type(box, value) {
  await act(async () => {
    box.focus();
    box.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    box.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
  await settle();
}

test("a question queued while the agent is running keeps one bubble from the moment it is delivered until the reply ends, and that bubble answers to the saved id", async (t) => {
  const id = "queued-question";
  const opening = assistantReply([textBlock("我先看一眼。")], "toolUse", 1004);
  let current = turnDetail(id, [userTurn()]);
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => ({ running: false }),
    sendAgentCommand: async () => ({}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, ChatWindow, {
    session: current.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();

  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: opening });
  const box = byRole(view.container, "textbox");
  await type(box, QUEUED);
  await click(byRole(view.container, "button", "Send"));
  await settle();
  assert.deepEqual(
    host.sendCommands
      .filter((command) => /^(?:follow_up|steer)$/.test(command.payload.type))
      .map((command) => command.payload.message),
    [QUEUED],
    "the composer hands the question to the running agent instead of starting a new turn",
  );

  const delivered = { role: "user", content: QUEUED, timestamp: 1010 };
  const answer = assistantReply([textBlock("src/main.ts 没问题。")], "stop", 1020);
  await emit(host, { type: "message_start", message: delivered });
  await emit(host, { type: "message_end", message: delivered });
  const bubble = () =>
    [...view.container.querySelectorAll("[data-reading-anchor]")].find((node) => node.textContent.includes(QUEUED));
  const queued = bubble();
  assert.ok(queued, "the queued question shows up as a bubble once the agent takes it");

  await emit(host, { type: "message_saved", entryId: `${id}-entry-2` });
  assert.ok(bubble() === queued, "the bubble stays the same one when its saved id arrives");
  assert.equal(
    queued.getAttribute("data-reading-anchor"),
    `entry:${id}-entry-2:message`,
    "it answers to the id the session file gave it",
  );

  await emit(host, { type: "message_end", message: assistantReply([textBlock("先看过了。")], "stop", 1012) });
  current = turnDetail(id, [userTurn(), opening, { ...delivered }, answer]);
  await emit(host, { type: "agent_end" });
  assert.ok(bubble() === queued && queued.isConnected, "the bubble is still the same one after the reply ends");
  assert.equal(
    queued.getAttribute("data-reading-anchor"),
    `entry:${id}-entry-2:message`,
    "the id does not change when the finished conversation is read again",
  );
});
