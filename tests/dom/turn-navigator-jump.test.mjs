import assert from "node:assert/strict";
import test, { after } from "node:test";
import { act, button, byRole, click, dom, restoreGlobals } from "../support/renderer.mjs";
import { waitFor } from "../support/dom-events.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";
import {
  heldPagesHost,
  installBrowserEventGlobals,
  installResizeObservers,
  layOutConversation,
  scrollConversationTo,
} from "../support/turn-outline-scene.mjs";
import {
  CONTENT_HEIGHT,
  FULL_READING_ORDER,
  QUESTION_TOPS,
  TURN_NAMES,
  VIEW_HEIGHT,
  fiveQuestionHistory,
} from "../fixtures/turn-outline-history.mjs";

after(restoreGlobals);

const LOADING = "Loading earlier messages…";
const ALERT = "Earlier messages could not be loaded.";

const messagesArea = (view) => byRole(view.container, "group", "Messages");

function turnButton(view, index) {
  const turn = button(view.container, TURN_NAMES[index]);
  assert.ok(turn, `the navigator offers a turn for “${TURN_NAMES[index]}”`);
  return turn;
}

async function openJumpScene(t, id) {
  const { detail, pages } = fiveQuestionHistory(id);
  const held = heldPagesHost(detail, pages);
  const resizes = installResizeObservers(t);
  const scene = await openConversation(t, { host: held.host, props: { session: detail.info } });
  const container = byRole(scene.view.container, "region", /^(Conversation|对话内容)$/);
  assert.ok(container, "the loaded conversation has its scroll area");
  layOutConversation(t, container, {
    viewHeight: VIEW_HEIGHT,
    contentHeight: CONTENT_HEIGHT,
    questionTops: QUESTION_TOPS,
  });
  await scrollConversationTo(container, 0);
  const controller = {
    ...held,
    async release(cursor) {
      await held.release(cursor);
      await scene.drain({ passes: 3 });
      await act(async () => {
        resizes.resize(container);
        if (container.firstElementChild) resizes.resize(container.firstElementChild);
      });
      await scene.drain({ passes: 3 });
    },
  };
  return { scene, controller, container, detail };
}

function assertReadingOrder(view, values, label) {
  const content = messagesArea(view).textContent;
  for (const value of values) {
    assert.equal(content.split(value).length - 1, 1, `${label}: “${value}” is on screen exactly once`);
  }
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(
      content.indexOf(values[index - 1]) < content.indexOf(values[index]),
      `${label}: “${values[index]}” is read after “${values[index - 1]}”`,
    );
  }
}

test("when the reader chooses a question that is not loaded yet, the conversation reads up to that question and stops there", async (t) => {
  const { scene, controller, container } = await openJumpScene(t, "jump-to-unloaded");
  await click(turnButton(scene.view, 1));
  await scene.settle(() =>
    assert.ok(button(scene.view.container, LOADING), "the reader is told earlier messages are still being read"),
  );

  await controller.release("page-4");
  await controller.release("page-3");
  await controller.release("page-2");
  await waitFor(() => assert.equal(container.scrollTop, 984), { timeout: 2000 });

  assert.deepEqual(
    controller.requests(),
    ["page-4", "page-3", "page-2"],
    "the jump stops at the page holding question 2",
  );
  assertReadingOrder(scene.view, FULL_READING_ORDER.slice(2), "the questions read on the way");
  const content = messagesArea(scene.view).textContent;
  assert.equal(content.includes(FULL_READING_ORDER[0]), false, "the page before the chosen question stays unread");
});

test("when the reader chooses a loaded question while another one is loading, the view moves to the last choice and later arrivals leave it alone", async (t) => {
  const { scene, controller, container } = await openJumpScene(t, "jump-last-click-wins-loaded");
  await click(turnButton(scene.view, 0));
  await scene.settle(() => assert.ok(button(scene.view.container, LOADING), "the first click starts reading"));

  await click(turnButton(scene.view, 4));
  await waitFor(() => assert.equal(container.scrollTop, 3984), { timeout: 2000 });

  await controller.release("page-4");
  await scene.drain();
  await waitFor(() => assert.ok(messagesArea(scene.view).textContent.includes(FULL_READING_ORDER[6])), {
    timeout: 2000,
  });
  assert.equal(container.scrollTop, 3984, "the arriving page leaves the reader on the question they clicked last");
  assert.deepEqual(controller.requests(), ["page-4"], "the abandoned jump asks for no further page");
});

test("when the reader chooses an earlier question while one is still loading, reading continues to the last choice and every page is read once", async (t) => {
  const { scene, controller, container } = await openJumpScene(t, "jump-last-click-wins-unloaded");
  await scrollConversationTo(container, 500);
  await click(turnButton(scene.view, 2));
  await scene.settle(() => assert.ok(button(scene.view.container, LOADING), "the first click starts reading"));

  await click(turnButton(scene.view, 1));
  await controller.release("page-4");
  await controller.release("page-3");
  await controller.release("page-2");
  await waitFor(() => assert.equal(container.scrollTop, 984), { timeout: 2000 });
  await scene.drain();

  assert.deepEqual(
    controller.requests(),
    ["page-4", "page-3", "page-2"],
    "each page up to the last choice is read once and the page before it is not read",
  );
  assertReadingOrder(scene.view, FULL_READING_ORDER.slice(2), "after the jump");
});

for (const gesture of [
  {
    name: "the wheel",
    use: (container) => container.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -120, bubbles: true })),
  },
  {
    name: "the PageUp key",
    use: () => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "PageUp", bubbles: true })),
  },
]) {
  test(`when the reader scrolls up with ${gesture.name} while a question is loading, the conversation stays where the reader left it`, async (t) => {
    installBrowserEventGlobals(t);
    const { scene, controller, container } = await openJumpScene(
      t,
      `jump-cancelled-by-${gesture.name.replaceAll(" ", "-")}`,
    );
    await scrollConversationTo(container, 300);
    await click(turnButton(scene.view, 1));
    await scene.settle(() => assert.ok(button(scene.view.container, LOADING), "the jump is under way"));

    await act(async () => gesture.use(container));
    await scrollConversationTo(container, 180);
    await controller.release("page-4");
    await waitFor(() => assert.ok(messagesArea(scene.view).textContent.includes(FULL_READING_ORDER[6])), {
      timeout: 2000,
    });
    await scene.drain();

    assert.equal(container.scrollTop, 180, "the reader keeps the place they scrolled to");
    assert.deepEqual(controller.requests(), ["page-4"], "a cancelled jump asks for no further page");
  });
}

test("when a page fails while jumping to a question, the reader is told, the arrived pages stay, and Retry finishes the jump", async (t) => {
  const { scene, controller, container } = await openJumpScene(t, "jump-page-failed");
  await scrollConversationTo(container, 300);
  await click(turnButton(scene.view, 1));
  await scene.settle(() => assert.ok(button(scene.view.container, LOADING), "the jump is under way"));

  await controller.release("page-4");
  await controller.fail("page-3");
  await scene.settle(() => {
    assert.ok(button(scene.view.container, "Retry"), "the failure offers a retry");
    assert.ok(scene.view.container.textContent.includes(ALERT), "the failure is described where the reader is looking");
  });
  assert.equal(container.scrollTop, 300, "a failed page does not move the view");
  assert.ok(
    messagesArea(scene.view).textContent.includes(FULL_READING_ORDER[6]),
    "the page that did arrive stays in the transcript",
  );

  await click(button(scene.view.container, "Retry"));
  await controller.release("page-3");
  await controller.release("page-2");
  await waitFor(() => assert.equal(container.scrollTop, 984), { timeout: 2000 });

  const requests = controller.requests();
  assert.deepEqual(requests, ["page-4", "page-3", "page-3", "page-2"], "Retry reads on from the failed cursor");
  assert.equal(button(scene.view.container, "Retry"), undefined, "the failure notice clears once the jump finishes");
});
