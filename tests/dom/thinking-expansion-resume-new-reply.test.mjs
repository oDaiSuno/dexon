import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, click, dom, loadRenderer, mount, restoreGlobals } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { assistantReply, textBlock, thinkingBlock, userTurn } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc } = await loadRenderer(
  "thinking-expansion-resume-new-reply",
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

async function openGroup(root) {
  const [group] = groupRows(root);
  assert.ok(group, "the process of the reply waits behind a block the reader can open");
  if (group.getAttribute("aria-expanded") === "false") await click(group);
}

function pageOf(id, messages, streamingMessage) {
  return createSessionDetail(id, {
    messages,
    entryIds: messages.map((_message, index) => `${id}-entry-${index}`),
    ...(streamingMessage ? { agentState: { running: true, state: { isStreaming: true, streamingMessage } } } : {}),
  });
}

async function scene(t, detail) {
  const host = createSessionTestHost({
    getSession: async () => detail(),
    agentState: async () => ({ running: false }),
    sendAgentCommand: async () => ({}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  const thinkingExpansionStore = new ThinkingExpansionStore();
  const processDetailsExpansionStore = new ThinkingExpansionStore();
  const open = async () => {
    const view = await mount(t, ChatWindow, {
      session: detail().info,
      newSessionCwd: null,
      thinkingExpansionStore,
      processDetailsExpansionStore,
    });
    await settle();
    return view;
  };
  return { host, boundary, open };
}

test("a reply ends and a retried reply starts while the reader is away: the new block comes back collapsed and takes no state from the old one", async (t) => {
  const id = "resume-new-reply";
  const question = userTurn();
  const firstReply = assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004);
  const firstFinished = assistantReply([thinkingBlock("第1段思考"), textBlock("先停一下。")], "error", 1004);
  const secondReply = assistantReply([thinkingBlock("第2段思考")], "toolUse", 2040);
  const secondFinished = assistantReply([thinkingBlock("第2段思考"), textBlock("这次成功了。")], "stop", 2040);
  let detail = () => pageOf(id, [], null);
  const { host, boundary, open } = await scene(t, () => detail());
  t.after(() => boundary.close());

  const first = await open();
  t.after(async () => {
    await first.unmount();
  });
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_end", message: question });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-0` });
  await emit(host, { type: "message_start", message: firstReply });
  await openGroup(first.container);
  assert.equal(states(groupRows(first.container)), "open", "the reader opens the block of the reply in progress");
  await first.unmount();

  detail = () => pageOf(id, [question, firstFinished], secondReply);

  const second = await open();
  t.after(async () => {
    await second.unmount();
  });
  assert.equal(
    groupRows(second.container).length,
    2,
    "the finished reply and the reply now streaming are both on screen",
  );
  assert.equal(
    states(groupRows(second.container)),
    "closed,closed",
    "the reply that showed up while the reader was away stays collapsed instead of copying the old block",
  );
  assert.equal(thinkingRows(second.container).length, 0, "nothing of the new reply is spread out on screen");

  await emit(host, { type: "message_end", message: secondFinished });
  detail = () => pageOf(id, [question, firstFinished, secondFinished], null);
  await emit(host, { type: "message_saved", entryId: `${id}-entry-2` });
  assert.equal(
    states(groupRows(second.container)),
    "closed,closed",
    "the block of the retried reply stays collapsed once it is saved under its own id",
  );
});

test("a reply that is still streaming when the reader comes back keeps the block the reader opened", async (t) => {
  const id = "resume-same-reply";
  const question = userTurn();
  const reply = assistantReply([thinkingBlock("第1段思考")], "toolUse", 1004);
  let detail = () => pageOf(id, [], null);
  const { host, boundary, open } = await scene(t, () => detail());
  t.after(() => boundary.close());

  const first = await open();
  t.after(async () => {
    await first.unmount();
  });
  await emit(host, { type: "agent_start" });
  await emit(host, { type: "message_end", message: question });
  await emit(host, { type: "message_saved", entryId: `${id}-entry-0` });
  await emit(host, { type: "message_start", message: reply });
  await openGroup(first.container);
  assert.equal(states(groupRows(first.container)), "open", "the reader opens the block of the reply in progress");
  await first.unmount();

  detail = () => pageOf(id, [question], assistantReply([thinkingBlock("第1段思考，又多想了一句")], "toolUse", 1004));

  const second = await open();
  t.after(async () => {
    await second.unmount();
  });
  assert.equal(
    states(groupRows(second.container)),
    "open",
    "the same still-streaming reply keeps the block the reader opened",
  );
  await emit(host, {
    type: "message_update",
    message: assistantReply([thinkingBlock("第1段思考，又多想了一句，还想说第三句")], "toolUse", 7777),
  });
  assert.equal(
    states(groupRows(second.container)),
    "open",
    "the block keeps its choice while the reply keeps streaming",
  );
  assert.match(
    thinkingRows(second.container)[0].textContent,
    /还想说第三句/,
    "the newest words of the reply land in the same block the reader opened",
  );
});
