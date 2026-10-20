import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, button, byRole, click, restoreGlobals, text } from "../support/renderer.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  FIRST_ANSWER,
  FIRST_QUESTION,
  HISTORY_TEXTS,
  SECOND_ANSWER,
  SECOND_QUESTION,
  THIRD_ANSWER,
  THIRD_QUESTION,
  assistantMessage,
  fivePageHistory,
  pagesHost,
  userMessage,
} from "../fixtures/chat-history-pages.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";

after(restoreGlobals);

const messagesArea = (view) => byRole(view.container, "group", "Messages");
const earlierArea = (view) => byRole(view.container, "group", "Earlier messages");

function olderPageRequests(host) {
  return host.getCommands.filter((command) => command.rpc === "getSessionContextPage");
}

async function openFivePageConversation(t) {
  const { detail, pages } = fivePageHistory();
  const host = createSessionTestHost({ getSession: async () => detail, ...pagesHost(pages) });
  const scene = await openConversation(t, { host, props: { session: detail.info } });
  await scene.settle(() => {
    assert.ok(earlierArea(scene.view), "older history is offered before the reader asks for it");
  });
  return { ...scene, detail };
}

test("when a conversation needs five pages, keeping the earlier-messages area in view reaches the first question without a click", async (t) => {
  const scene = await openFivePageConversation(t);
  const sentinel = earlierArea(scene.view);
  await scene.signalInView(sentinel);
  await scene.settle(() => {
    assert.ok(
      text(messagesArea(scene.view), HISTORY_TEXTS[0]),
      "the first question of the conversation becomes readable",
    );
  });
  for (const value of HISTORY_TEXTS) {
    assert.equal(messagesArea(scene.view).textContent.split(value).length - 1, 1, `“${value}” appears exactly once`);
  }
  const content = messagesArea(scene.view).textContent;
  const positions = HISTORY_TEXTS.map((value) => content.indexOf(value));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `“${HISTORY_TEXTS[index]}” is read after the line before it`);
  }
  assert.deepEqual(
    olderPageRequests(scene.host).map((command) => command.args[0]),
    ["page-4", "page-3", "page-2", "page-1"],
    "each older page is requested once, in reading order",
  );
  assert.equal(earlierArea(scene.view), undefined, "nothing earlier is offered once the start of history is reached");
});

test("when the reader stays at the top while a page is loading, only one request goes out for that page", async (t) => {
  const { detail, pages } = fivePageHistory("stays-at-top");
  let release;
  let requests = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async (sid, cursor) => {
      requests += 1;
      if (cursor !== "page-4") return pagesHost(pages).getSessionContextPage(sid, cursor);
      return new Promise((resolve) => (release = () => resolve(pages["page-4"])));
    },
  });
  const scene = await openConversation(t, { host, props: { session: detail.info } });
  await scene.settle(() => assert.ok(earlierArea(scene.view)));
  const sentinel = earlierArea(scene.view);
  for (let signal = 0; signal < 3; signal += 1) await scene.signalInView(sentinel);
  assert.equal(requests, 1, "three in-view signals while one page is loading submit one request");
  await scene.settle(() => assert.ok(release, "the page request reached the host"));
  await act(async () => release());
  await scene.settle(() => assert.ok(text(messagesArea(scene.view), SECOND_ANSWER), "the page arrives on screen"));
  const cursors = olderPageRequests(scene.host).map((command) => command.args[0]);
  assert.equal(cursors[0], "page-4", "the page under the reader's view is requested first");
  assert.equal(new Set(cursors).size, cursors.length, "the reader's repeated signals never queue a page twice");
});

test("when an older page brings nothing new, that page is not requested again on its own", async (t) => {
  const detail = createSessionDetail("no-progress", {
    messages: [userMessage(THIRD_QUESTION, 5), assistantMessage(THIRD_ANSWER, 6)],
    entryIds: ["entry-5", "entry-6"],
    previousCursor: "same-cursor",
    historyRevision: "history-revision",
  });
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => ({
      context: {
        messages: [],
        entryIds: [],
        historyRevision: "history-revision",
        previousCursor: "same-cursor",
      },
      truncated: false,
    }),
  });
  const scene = await openConversation(t, { host, props: { session: detail.info } });
  await scene.settle(() => assert.ok(earlierArea(scene.view)));
  const sentinel = earlierArea(scene.view);
  await scene.signalInView(sentinel);
  await scene.settle(() => assert.equal(olderPageRequests(scene.host).length, 1));
  await scene.signalInView(sentinel);
  await scene.settle(() => assert.ok(true));
  assert.equal(
    olderPageRequests(scene.host).length,
    1,
    "a page with no new content is not requested again while the area stays in view",
  );
  assert.ok(button(scene.view.container, "Load earlier messages"), "the reader can still ask for it by hand");
});

test("when an older page fails, the reader is told and offered a retry, and the automatic retry backs off", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { detail, pages } = fivePageHistory("failing-page");
  let serving = false;
  let attempts = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async (_sid, cursor) => {
      attempts += 1;
      if (!serving) throw new Error("Host read failed");
      return pages[cursor];
    },
  });
  const scene = await openConversation(t, { host, props: { session: detail.info } });
  await scene.settle(() => assert.ok(earlierArea(scene.view)));

  async function waitForRetry(previousAttempts) {
    let waited = 0;
    while (attempts === previousAttempts) {
      assert.ok(waited < 60_000, "the failed page is retried on its own");
      await act(async () => t.mock.timers.tick(100));
      waited += 100;
      await scene.settle(() => assert.ok(true));
    }
    return waited;
  }

  await scene.signalInView(earlierArea(scene.view));
  await scene.settle(() => assert.ok(button(scene.view.container, "Retry"), "the failure offers a retry"));
  assert.ok(
    scene.view.container.textContent.includes("Earlier messages could not be loaded."),
    "the failure is described where the reader is looking",
  );
  assert.equal(attempts, 1, "the failed page was requested once");

  const waits = [await waitForRetry(1)];
  assert.ok(waits[0] > 0, "the automatic retry waits instead of firing immediately");
  for (let failure = 1; failure < 6; failure += 1) {
    assert.ok(button(scene.view.container, "Retry"), "each failure keeps the retry on offer");
    waits.push(await waitForRetry(failure + 1));
  }
  for (let index = 1; index < waits.length; index += 1) {
    assert.ok(waits[index] >= waits[index - 1], `automatic retry ${index} waited no less than the one before it`);
  }
  assert.ok(waits[4] > waits[0], "repeated failures wait longer than the first attempt did");
  assert.equal(waits[5], waits[4], "the wait stops growing once it reaches its ceiling");

  serving = true;
  await click(button(scene.view.container, "Retry"));
  await scene.settle(() => assert.ok(text(messagesArea(scene.view), SECOND_ANSWER), "the retried page arrives"));
  assert.equal(button(scene.view.container, "Retry"), undefined, "the failure notice disappears once a page arrives");
});

test("when the chat is hidden after a failed page, the waiting retry sends nothing until the reader comes back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { detail } = fivePageHistory("hidden-failing-page");
  let attempts = 0;
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: async () => {
      attempts += 1;
      throw new Error("Host read failed");
    },
  });
  const props = { session: detail.info };
  const scene = await openConversation(t, { host, props });
  await scene.settle(() => assert.ok(earlierArea(scene.view)));
  await scene.signalInView(earlierArea(scene.view));
  await scene.settle(() => assert.ok(button(scene.view.container, "Retry")));
  assert.equal(attempts, 1, "the failed page was requested once");

  await scene.rerender({ visible: false });
  await act(async () => t.mock.timers.tick(60_000));
  await scene.settle(() => assert.ok(true));
  assert.equal(attempts, 1, "a hidden chat sends no automatic retry, however long it stays hidden");

  await scene.rerender({ visible: true });
  await scene.signalInView(earlierArea(scene.view));
  await act(async () => t.mock.timers.tick(60_000));
  await scene.settle(() => assert.equal(attempts, 2));
  assert.ok(button(scene.view.container, "Retry"), "the retry stays on offer after returning to the chat");
});

test("when the history changes underneath the reader, reading continues automatically from the reloaded history without a click", async (t) => {
  const id = "stale-cursor";
  const newestMessages = [userMessage(THIRD_QUESTION, 5), assistantMessage(THIRD_ANSWER, 6)];
  const before = createSessionDetail(id, {
    messages: newestMessages,
    entryIds: ["entry-5", "entry-6"],
    previousCursor: "stale-cursor",
    historyRevision: "revision-1",
  });
  const after = createSessionDetail(id, {
    messages: newestMessages,
    entryIds: ["entry-5", "entry-6"],
    previousCursor: "reloaded-cursor",
    historyRevision: "revision-2",
  });
  let sessionReads = 0;
  const host = createSessionTestHost({
    getSession: async () => {
      sessionReads += 1;
      return sessionReads === 1 ? before : after;
    },
    getSessionContextPage: async (_sid, cursor) => {
      if (cursor === "stale-cursor") throw new Error("STALE_CURSOR: the history moved on");
      return {
        context: {
          messages: [
            userMessage(FIRST_QUESTION, 1),
            assistantMessage(FIRST_ANSWER, 2),
            userMessage(SECOND_QUESTION, 3),
            assistantMessage(SECOND_ANSWER, 4),
          ],
          entryIds: ["entry-1", "entry-2", "entry-3", "entry-4"],
          historyRevision: "revision-2",
          previousCursor: null,
        },
        truncated: false,
      };
    },
  });
  const scene = await openConversation(t, { host, props: { session: before.info } });
  await scene.settle(() => assert.ok(earlierArea(scene.view)));

  await scene.signalInView(earlierArea(scene.view));
  await scene.settle(() => assert.equal(sessionReads, 2, "the moved history is reloaded"));
  await scene.settle(() => {
    assert.ok(
      text(messagesArea(scene.view), FIRST_QUESTION),
      "the reloaded history continues to load without the reader asking again",
    );
  });
  for (const value of HISTORY_TEXTS) {
    assert.equal(messagesArea(scene.view).textContent.split(value).length - 1, 1, `“${value}” appears exactly once`);
  }
  assert.equal(button(scene.view.container, "Retry"), undefined, "a changed history is not reported as a failure");
  assert.equal(
    earlierArea(scene.view),
    undefined,
    "the reader reaches the start of the reloaded history without clicking",
  );
});
