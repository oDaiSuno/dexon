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
  "thinking-expansion-resume",
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

async function resumedScene(t, id) {
  const reply = assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004);
  const running = { running: true, state: { isStreaming: true, streamingMessage: reply } };
  let current = createSessionDetail(id, {
    messages: [userTurn()],
    entryIds: [`${id}-entry-0`],
    agentState: running,
  });
  const host = createSessionTestHost({
    getSession: async () => current,
    agentState: async () => running,
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

test("when the reader opens a session whose reply is already running, the segment they close stays closed through the next update and after the message is saved", async (t) => {
  const id = "resume";
  const { root, host, setDetail } = await resumedScene(t, id);
  await openGroup(root);
  assert.ok(thinkingRows(root).length === 1, "the running reply is on screen");
  assert.equal(states(thinkingRows(root)), "open", "an untouched live segment shows its text without being asked");

  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "closed", "one click closes it");

  await emit(host, {
    type: "message_update",
    message: assistantReply([thinkingBlock("第1段思考，又多想了一句")], "toolUse", 1004),
  });
  assert.match(thinkingRows(root)[0].textContent, /又多想了一句/, "the preview keeps updating");
  assert.equal(states(thinkingRows(root)), "closed", "the reader's close survives the next update");

  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "open", "the next click opens that same segment again");

  const finished = assistantReply([thinkingBlock("第1段思考"), textBlock("结论：配置正常。")], "stop", 1004);
  await emit(host, { type: "message_end", message: finished });
  setDetail(turnDetail(id, [userTurn(), finished]));
  await emit(host, { type: "message_saved", entryId: `${id}-entry-1` });

  await openGroup(root);
  assert.equal(states(thinkingRows(root)), "open", "the choice carries over to the saved id instead of being lost");
  assert.equal(anchorOf(thinkingRows(root)[0]), `entry:${id}-entry-1:message`, "it now answers to the saved id");
  await click(thinkingRows(root)[0]);
  assert.equal(states(thinkingRows(root)), "closed", "the saved segment answers the next click");
});
