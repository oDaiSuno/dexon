import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { assistantReply, textBlock, thinkingBlock, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "thinking-expansion-switch-away",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

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

const thinkingRows = (root) =>
  [...root.querySelectorAll("button[aria-expanded]")].filter((node) => /Deep thinking/.test(node.textContent));
const groupRows = (root) =>
  [...root.querySelectorAll("button[aria-expanded]")].filter((node) =>
    /Processed|Process details/.test(node.textContent),
  );
const states = (buttons) =>
  buttons.map((node) => (node.getAttribute("aria-expanded") === "true" ? "open" : "closed")).join(",");
const anchorOf = (row) => row.closest("[data-reading-anchor]")?.getAttribute("data-reading-anchor");

async function openGroup(root) {
  const [group] = groupRows(root);
  assert.ok(group, "the process of the reply waits behind a block the reader can open");
  if (group.getAttribute("aria-expanded") === "false") await click(group);
}

test("when the reader closes the segment that is still thinking, leaves for another conversation and returns while it is still generating, that segment is still closed and then answers to the saved id", async (t) => {
  const id = "away-and-back";
  const question = userTurn();
  const reply = assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004);
  let current = turnDetail(id, []);
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => ({ running: false }),
    sendAgentCommand: async () => ({}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  t.after(() => boundary.close());

  const thinkingExpansionStore = new ThinkingExpansionStore();
  const processDetailsExpansionStore = new ThinkingExpansionStore();
  const openPage = async () => {
    const view = await mount(t, ChatWindow, {
      session: current.info,
      newSessionCwd: null,
      thinkingExpansionStore,
      processDetailsExpansionStore,
    });
    await settle();
    return view;
  };

  const first = await openPage();
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_end", message: question });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-0` });
  await emit(host, { type: "message_update", message: reply });
  await openGroup(first.container);
  assert.equal(states(thinkingRows(first.container)), "open", "the segment that is still thinking shows its text");
  await click(thinkingRows(first.container)[0]);
  assert.equal(states(thinkingRows(first.container)), "closed", "the reader closes it while the reply is generating");
  await first.unmount();

  current = createSessionDetail(id, {
    messages: [question],
    entryIds: [`${id}-entry-0`],
    agentState: { running: true, state: { isStreaming: true, streamingMessage: reply } },
  });
  const second = await openPage();
  assert.equal(
    states(groupRows(second.container)),
    "open",
    "returning to the conversation while it is still generating keeps the block the reader opened",
  );
  assert.equal(
    states(thinkingRows(second.container)),
    "closed",
    "returning to the conversation while it is still generating keeps the segment the reader closed",
  );

  const finished = assistantReply([thinkingBlock("第1段思考"), textBlock("结论：配置正常。")], "stop", 1004);
  await emit(host, { type: "message_end", message: finished });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });
  current = turnDetail(id, [question, finished]);
  assert.equal(states(groupRows(second.container)), "open", "the block stays open once the reply is saved");
  assert.equal(states(thinkingRows(second.container)), "closed", "the choice follows the message to its saved id");
  assert.equal(anchorOf(thinkingRows(second.container)[0]), `entry:${id}-entry-1:message`);
});
