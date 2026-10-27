import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, byRole, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { assistantReply, followUpUserTurn, textBlock, turnDetail, userTurn } from "../fixtures/chat-answer-turn.mjs";

const api = await loadRenderer(
  "retry-resolved-failure",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
api.setAppLanguage("zh-CN");
const { ChatWindow, ThinkingExpansionStore, resetRpc } = api;
after(restoreGlobals);

const BUSY_DETAIL = "503 upstream is overloaded";

function failedReply(extra = {}) {
  return { ...assistantReply([], "error", 1006), errorMessage: BUSY_DETAIL, ...extra };
}

function messagesOf(view) {
  const area = byRole(view.container, "group", /^(Messages|消息)$/);
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function failureCards(view) {
  return [...messagesOf(view).querySelectorAll('[role="alert"]')];
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function mountTurn(t, detail) {
  const host = createSessionTestHost({ getSession: async () => detail });
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
    session: detail.info,
    newSessionCwd: null,
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  return { view };
}

test("when a failed request in a turn is followed by a successful answer, the reader sees only the answer and no failure card", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("retry-resolved-by-answer", [
      userTurn(),
      failedReply(),
      assistantReply([textBlock("Recovered answer")], "stop", 1012),
    ]),
  );
  const root = messagesOf(view);
  assert.ok(text(root, "Recovered answer"), "the answer the retry produced is readable");
  assert.equal(failureCards(view).length, 0, "a failure the turn later answered leaves no card behind");
  assert.doesNotMatch(
    root.textContent,
    /upstream is overloaded/,
    "the reader is not told about a failure that the retry resolved",
  );
});

test("when every automatic retry fails, every failure card stays and the last one shows 2/2", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("retry-exhausted", [
      userTurn(),
      failedReply(),
      failedReply(),
      failedReply({ retry: { attempt: 2, maxAttempts: 2 } }),
    ]),
  );
  const cards = failureCards(view);
  assert.equal(cards.length, 3, "each failed attempt keeps its own card");
  assert.match(cards.at(-1).textContent, /重试失败/);
  assert.match(cards.at(-1).textContent, /2\/2/);
});

test("when a request fails without a retry, the card says the request failed", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("request-failed", [userTurn(), failedReply({ errorMessage: "400 bad request" })]),
  );
  const cards = failureCards(view);
  assert.equal(cards.length, 1, "the failure of a request nobody retried keeps its card");
  assert.match(cards[0].textContent, /请求失败/);
});

test("when the user stops during the retry wait, the failure card stays", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("retry-wait-stopped", [userTurn(), failedReply({ retry: { attempt: 1, maxAttempts: 2 } })]),
  );
  const cards = failureCards(view);
  assert.equal(cards.length, 1, "the request the user gave up on keeps its card");
  assert.match(cards[0].textContent, /重试失败/);
  assert.match(cards[0].textContent, /1\/2/);
});

test("when an earlier turn ends on a failure and a later turn answers, the earlier failure card stays", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("failure-then-next-turn", [
      userTurn(),
      failedReply(),
      followUpUserTurn(),
      assistantReply([textBlock("Second answer")], "stop", 1012),
    ]),
  );
  assert.ok(text(messagesOf(view), "Second answer"), "the answer of the later turn is readable");
  assert.equal(failureCards(view).length, 1, "an answer in a later turn does not resolve the earlier failure");
});

test("when a failure is followed by an answer the user stopped, the failure card stays", async (t) => {
  const { view } = await mountTurn(
    t,
    turnDetail("failure-then-stopped", [
      userTurn(),
      failedReply(),
      assistantReply([textBlock("Partial")], "aborted", 1012),
    ]),
  );
  const cards = failureCards(view);
  assert.equal(cards.length, 1, "a stopped reply is not an answer, so the failure before it keeps its card");
});
