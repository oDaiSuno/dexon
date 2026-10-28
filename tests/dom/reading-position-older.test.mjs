import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  dom,
  historyRow,
  restoreGlobals,
  roles,
  visibleText,
  waitFor,
} from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import {
  conversation,
  distanceFromBottom,
  installChatGeometry,
  readerScrollsTo,
  topOf,
} from "../support/chat-geometry.mjs";
import { answerMarker, markersOf, questionMarker, readingConversation } from "../fixtures/reading-position-data.mjs";

after(restoreGlobals);

const ONE_LINE = 24;
const ROW_HEIGHT = 200;
const PAGE_TURNS = 10;
const LOADING = "Loading earlier messages…";

const chat = (scene) => control(scene.container, "region", "Chat");

// The conversation opens on turns 21-30 and the reader asks for the page of
// turns 11-20 by hand, so both pages have their own first row.
const rowOnNewestPage = (turn) => (turn - (PAGE_TURNS * 2 + 1)) * 2;
const rowOnEarlierPage = (turn) => (turn - (PAGE_TURNS + 1)) * 2;

function screenTop(scene, sentence) {
  return (conversation(scene).textContent ?? "").includes(sentence) ? topOf(scene, sentence) : null;
}

async function readOnAnEarlierPage(t) {
  const first = readingConversation("long-paged", { name: "Long paged session", turns: 30, pageTurns: PAGE_TURNS });
  const second = readingConversation("long-second", { name: "Second reading session", turns: 12, pageTurns: 12 });
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: markersOf(first, second) });

  await click(historyRow(scene, "Long paged session"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-paged", 21)));
  await scene.settled();
  await click(control(chat(scene), "button", "Load earlier messages"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-paged", 15)));
  await scene.settled();

  const watched = questionMarker("long-paged", 15);
  await readerScrollsTo(scene, rowOnEarlierPage(15) * ROW_HEIGHT);
  const before = topOf(scene, watched);
  assert.ok(Math.abs(before) <= ONE_LINE, `“${watched}” is where the reader stopped (${before}px below the top)`);
  return { scene, watched, before, first };
}

async function leaveAndHoldTheEarlierPage(scene) {
  await click(historyRow(scene, "Second reading session"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-second", 1)));
  await scene.settled();
  return scene.external.hold("sessions.contextPage");
}

async function returnToThePagedConversation(scene) {
  await click(historyRow(scene, "Long paged session"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-paged", 21)));
}

async function waitForTheEarlierPageRequest(page, scene) {
  const loading = () => roles(chat(scene), "button", LOADING).length === 1;
  const deadline = Date.now() + 3000;
  let seenLoading = false;
  while (!page.reached() && Date.now() < deadline) {
    seenLoading ||= loading();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  return seenLoading || loading();
}

test("returning to a position on an earlier page shows that earlier messages are loading, then the same sentence at the same height", async (t) => {
  const { scene, watched, before } = await readOnAnEarlierPage(t);
  const page = await leaveAndHoldTheEarlierPage(scene);

  await returnToThePagedConversation(scene);
  const loadingShown = await waitForTheEarlierPageRequest(page, scene);
  if (page.reached()) page.release();
  await scene.settled();

  const after = screenTop(scene, watched);
  assert.ok(
    after !== null && Math.abs(after - before) <= ONE_LINE,
    `“${watched}” should be at the same height after returning: before ${before}px, after ${after === null ? "not on screen" : `${after}px`}`,
  );
  assert.ok(page.reached(), "returning asked the Host for the earlier page that holds that sentence");
  assert.ok(loadingShown, `the reader was told “${LOADING}” while that page was being read`);

  const expected = [];
  for (let turn = 15; turn <= 30; turn += 1)
    expected.push(questionMarker("long-paged", turn), answerMarker("long-paged", turn));
  const content = conversation(scene).textContent;
  for (const sentence of expected)
    assert.equal(content.split(sentence).length - 1, 1, `“${sentence}” appears exactly once`);
  const positions = expected.map((sentence) => content.indexOf(sentence));
  for (let index = 1; index < positions.length; index += 1)
    assert.ok(positions[index - 1] < positions[index], `“${expected[index]}” is read after “${expected[index - 1]}”`);
});

test("if the reader scrolls while the earlier page is loading, the view stays where the reader scrolled", async (t) => {
  const { scene } = await readOnAnEarlierPage(t);
  const page = await leaveAndHoldTheEarlierPage(scene);

  await returnToThePagedConversation(scene);
  await waitForTheEarlierPageRequest(page, scene);
  const watched = questionMarker("long-paged", 24);
  const container = conversation(scene);
  await act(async () => {
    container.dispatchEvent(new dom.window.WheelEvent("wheel", { deltaY: -1, bubbles: true, cancelable: true }));
    container.scrollTop = rowOnNewestPage(24) * ROW_HEIGHT;
    container.dispatchEvent(new dom.window.Event("scroll"));
  });
  const top = topOf(scene, watched);

  if (page.reached()) page.release();
  await scene.settled();

  const after = topOf(scene, watched);
  assert.ok(
    Math.abs(after - top) <= ONE_LINE,
    `“${watched}” should stay where the reader scrolled it: before ${top}px, after ${after}px`,
  );
  assert.ok(page.reached(), "returning asked the Host for the earlier page that was still loading");
});

test("if the earlier page brings nothing new while returning, the conversation lands at the latest message", async (t) => {
  const { scene, first } = await readOnAnEarlierPage(t);
  const cursor = first.context.previousCursor;
  const page = first.pages[cursor];
  first.pages[cursor] = {
    context: {
      messages: [],
      entryIds: [],
      historyRevision: page.context.historyRevision,
      previousCursor: cursor,
    },
    truncated: false,
  };

  await click(historyRow(scene, "Second reading session"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-second", 1)));
  await scene.settled();
  await returnToThePagedConversation(scene);
  await scene.settled();

  assert.equal(distanceFromBottom(scene), 0, "the reader is at the latest message when nothing earlier arrives");
});

test("if the earlier page cannot be read, the reader sees the existing failure notice with Retry", async (t) => {
  const { scene, watched, before } = await readOnAnEarlierPage(t);
  const page = await leaveAndHoldTheEarlierPage(scene);

  await returnToThePagedConversation(scene);
  await waitForTheEarlierPageRequest(page, scene);
  if (page.reached()) page.fail("Host read failed");
  await scene.settled();

  assert.ok(page.reached(), "returning asked the Host for the earlier page that failed");
  visibleText(chat(scene), "Earlier messages could not be loaded.");

  await click(control(chat(scene), "button", "Retry"));
  await scene.settled();
  const after = screenTop(scene, watched);
  assert.ok(
    after !== null && Math.abs(after - before) <= ONE_LINE,
    `once the retried page arrives, “${watched}” is back at its height: before ${before}px, after ${after === null ? "not on screen" : `${after}px`}`,
  );
});
