import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { assistantReply, textBlock, thinkingBlock, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "message-saved-identity",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const SENTENCE = "结论：配置正常。";

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

function rows(root, pattern) {
  return [...root.querySelectorAll("button[aria-expanded]")].filter((node) => pattern.test(node.textContent));
}

const thinkingRows = (root) => rows(root, /Deep thinking/);
const groupRows = (root) => rows(root, /Processed|Process details/);
const states = (buttons) =>
  buttons.map((node) => (node.getAttribute("aria-expanded") === "true" ? "open" : "closed")).join(",");
const anchored = (root, sentence) =>
  [...root.querySelectorAll("[data-reading-anchor]")].find((node) => node.textContent.includes(sentence));

async function scene(t, id) {
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
  return {
    root: view.container,
    host,
    setDetail: (detail) => {
      current = detail;
    },
  };
}

test("when the reader clicks the thinking that is still being written closed and open again, it stays open once the reply is saved and after the reply ends", async (t) => {
  const id = "open-before-save";
  const { root, host, setDetail } = await scene(t, id);
  const reply = assistantReply([thinkingBlock("第1段思考"), textBlock(SENTENCE)], "stop", 1008);
  const tapTrace = () => click(thinkingRows(root)[0]);
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: reply });
  await tapTrace();
  await tapTrace();
  await emit(host, { type: "message_end", message: reply });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });
  assert.equal(
    states(thinkingRows(root)),
    "open",
    "the reply keeps the trace the reader opened while it was still being written",
  );
  setDetail(turnDetail(id, [userTurn(), reply]));
  await emit(host, { type: "agent_end" });
  assert.equal(states(groupRows(root)), "closed", "the Processed block starts closed");
  await click(groupRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "open", "reading the finished reply again finds the same trace open");
});

test("when a reply receives its saved id, the reply on screen stays the same element and its reading anchor names that id", async (t) => {
  const id = "reply-identity";
  const { root, host } = await scene(t, id);
  const reply = assistantReply([textBlock(SENTENCE)], "stop", 1008);
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_start", message: reply });
  await emit(host, { type: "message_end", message: reply });
  const shown = anchored(root, SENTENCE);
  assert.ok(shown, "the reply is on screen as soon as it finishes");
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });
  assert.ok(anchored(root, SENTENCE) === shown && shown.isConnected, "the saved id does not rebuild the reply");
  assert.equal(
    shown.getAttribute("data-reading-anchor"),
    `entry:${id}-entry-1:message`,
    "the reply now answers to the id the session file gave it",
  );
});
