import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
  dom,
  historyRow,
  keyDown,
  restoreGlobals,
  roles,
  visibleText,
  waitFor,
} from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { precedes } from "../support/dom-queries.mjs";
import {
  distanceFromBottom,
  installChatGeometry,
  readerScrollsTo,
  readerScrollsToBottom,
  topOf,
} from "../support/chat-geometry.mjs";
import { answerMarker, markersOf, questionMarker, readingConversation } from "../fixtures/reading-position-data.mjs";
import { delegateToolConversation, treeSession } from "../fixtures/session-tree-data.mjs";

after(restoreGlobals);

// One line of text is the tolerance for "the same height"; the layout shim
// makes the numbers exact, so the message is what a reader would notice.
const ONE_LINE = 24;

const chat = (scene) => control(scene.container, "region", "Chat");

const longReading = () =>
  readingConversation("long-reading", { name: "Long reading session", turns: 12, pageTurns: 12 });
const secondReading = () =>
  readingConversation("long-second", { name: "Second reading session", turns: 12, pageTurns: 12 });

async function open(scene, title, sentence) {
  await click(historyRow(scene, title));
  await waitFor(() => visibleText(chat(scene), sentence));
  await scene.settled();
}

async function readUpTo(scene, sentence, top) {
  await readerScrollsTo(scene, top);
  const before = topOf(scene, sentence);
  assert.ok(Math.abs(before) <= ONE_LINE, `“${sentence}” is where the reader stopped (${before}px below the top)`);
  return before;
}

function sameHeight(sentence, before, after) {
  assert.ok(
    Math.abs(after - before) <= ONE_LINE,
    `“${sentence}” should be at the same height after returning: before ${before}px, after ${after}px`,
  );
}

const composer = (scene) => control(chat(scene), "textbox");

// The composer is a rich-text editor: type through its own input event, the
// way the browser reports typing, without reading component state.
async function type(element, value) {
  await act(async () => {
    element.focus();
    element.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    element.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

const bottomJumps = (scene) => roles(chat(scene), "button", "Scroll to bottom").length;

test(
  "after reading an earlier part of a conversation, switching to another conversation in the sidebar and back shows the same sentence at the same height",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const first = longReading();
    const second = secondReading();
    const scene = await startSessionScene(t, [first, second]);
    installChatGeometry(t, { markers: markersOf(first, second) });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    await open(scene, "Long reading session", questionMarker("long-reading", 1));

    sameHeight(watched, before, topOf(scene, watched));
  },
);

test(
  "a child conversation opened from its nested row in the session tree returns to where it was read",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const root = treeSession("reading-root", { name: "Reading root" });
    const child = readingConversation("long-reading", {
      name: "Long reading session",
      turns: 12,
      pageTurns: 12,
      parentSessionId: "reading-root",
    });
    const second = secondReading();
    const scene = await startSessionScene(t, [root, child, second]);
    installChatGeometry(t, { markers: markersOf(child, second) });

    assert.ok(
      precedes(historyRow(scene, "Reading root"), historyRow(scene, "Long reading session")),
      "the child is listed under its parent",
    );
    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    await open(scene, "Long reading session", questionMarker("long-reading", 1));

    sameHeight(watched, before, topOf(scene, watched));
  },
);

test(
  "a child conversation opened from the main conversation's link returns to where it was read",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const parent = delegateToolConversation("reading-parent", {
      name: "Delegating reading session",
      target: "long-reading",
      targetTitle: "Long reading session",
      text: "Ask the long conversation where it was read.",
      reply: "Delegated reading finished",
    });
    const child = longReading();
    const scene = await startSessionScene(t, [parent, child]);
    installChatGeometry(t, { markers: markersOf(child) });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);

    await open(scene, "Delegating reading session", "Delegated reading finished");
    await click(control(chat(scene), "button", /process details/i));
    await click(await waitFor(() => control(chat(scene), "button", "Open session Long reading session")));
    await waitFor(() => visibleText(chat(scene), questionMarker("long-reading", 1)));
    await scene.settled();

    sameHeight(watched, before, topOf(scene, watched));
  },
);

test(
  "a conversation opened again from an external session link returns to where it was read",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const first = longReading();
    const second = secondReading();
    const scene = await startSessionScene(t, [first, second]);
    installChatGeometry(t, { markers: markersOf(first, second) });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    await act(async () => scene.external.deepLink("long-reading"));
    await waitFor(() => visibleText(chat(scene), questionMarker("long-reading", 1)));
    await scene.settled();

    sameHeight(watched, before, topOf(scene, watched));
  },
);

test("a round trip through Plugins & Skills keeps the reading position", async (t) => {
  const first = longReading();
  const second = secondReading();
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: markersOf(first, second) });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  await scene.resources();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  sameHeight(watched, before, topOf(scene, watched));
});

test("a round trip through Settings keeps the reading position", async (t) => {
  const first = longReading();
  const second = secondReading();
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: markersOf(first, second) });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  const settings = await scene.settings();
  await keyDown(settings, "Escape");
  await waitFor(() => assert.equal(roles(scene.container, "region", "Settings").length, 0, "Settings is closed"));
  await waitFor(() => visibleText(chat(scene), questionMarker("long-reading", 1)));
  await scene.settled();

  sameHeight(watched, before, topOf(scene, watched));
});

test(
  "two conversations each keep their own reading position while the reader moves back and forth",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const first = longReading();
    const second = secondReading();
    const scene = await startSessionScene(t, [first, second]);
    installChatGeometry(t, { markers: markersOf(first, second) });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watchedFirst = answerMarker("long-reading", 3);
    const beforeFirst = await readUpTo(scene, watchedFirst, 1000);

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    const watchedSecond = questionMarker("long-second", 3);
    const beforeSecond = await readUpTo(scene, watchedSecond, 800);

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    sameHeight(watchedFirst, beforeFirst, topOf(scene, watchedFirst));

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    sameHeight(watchedSecond, beforeSecond, topOf(scene, watchedSecond));
  },
);

test(
  "scrolling to the bottom of one conversation does not pull another conversation to its bottom",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const first = longReading();
    const second = secondReading();
    const scene = await startSessionScene(t, [first, second]);
    installChatGeometry(t, { markers: markersOf(first, second) });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);

    await open(scene, "Second reading session", questionMarker("long-second", 1));
    await readerScrollsToBottom(scene);

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    sameHeight(watched, before, topOf(scene, watched));
    const distance = distanceFromBottom(scene);
    assert.ok(distance > 0, `the reader is still away from the bottom of this conversation (${distance}px)`);
    assert.equal(bottomJumps(scene), 1, "the way back to the newest content is offered");
  },
);

test("the first time a conversation is opened in this run it shows the latest message at the very bottom without the scroll-to-bottom button", async (t) => {
  const first = longReading();
  const second = secondReading();
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: markersOf(first, second) });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  const distance = distanceFromBottom(scene);
  assert.equal(distance, 0, `the last message ends at the bottom of the view (${distance}px away)`);
  assert.equal(bottomJumps(scene), 0, "the reader is not invited to jump to the bottom they are already at");
});

test("after the app is reopened, a conversation opens at its latest message instead of the old position", async (t) => {
  const first = longReading();
  const second = secondReading();
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: markersOf(first, second) });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  await readUpTo(scene, answerMarker("long-reading", 3), 1000);
  await open(scene, "Second reading session", questionMarker("long-second", 1));

  const reopened = await scene.reload();
  await open(reopened, "Long reading session", questionMarker("long-reading", 1));

  const distance = distanceFromBottom(reopened);
  assert.equal(distance, 0, `a new run opens at the latest message (${distance}px away)`);
  assert.equal(bottomJumps(reopened), 0, "the reader is not invited to jump to the bottom they are already at");
});

test("when the message that was being read is no longer part of the conversation, returning shows the latest message at the very bottom", async (t) => {
  const first = longReading();
  const second = secondReading();
  const rewritten = readingConversation("long-reading", {
    name: "Long reading session",
    turns: 12,
    pageTurns: 12,
    wording: "Rewritten",
  });
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: [...markersOf(first, second), ...markersOf(rewritten)] });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  await readUpTo(scene, answerMarker("long-reading", 3), 1000);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  scene.external.replaceConversation("long-reading", rewritten);
  await open(scene, "Long reading session", "Rewritten question 01 of long-reading");

  const distance = distanceFromBottom(scene);
  assert.equal(
    distance,
    0,
    `the sentence that was read is gone, so the reader lands at the latest message (${distance}px away)`,
  );
  assert.equal(bottomJumps(scene), 0, "the reader is not invited to jump to the bottom they are already at");
});

test(
  "after returning to a restored position, sending a new question moves the view to that question",
  { todo: "issue #42: not implemented yet" },
  async (t) => {
    const fresh = "Fresh question after returning";
    const first = longReading();
    const second = secondReading();
    const scene = await startSessionScene(t, [first, second]);
    installChatGeometry(t, { markers: [...markersOf(first, second), fresh] });

    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    const watched = answerMarker("long-reading", 3);
    const before = await readUpTo(scene, watched, 1000);
    await open(scene, "Second reading session", questionMarker("long-second", 1));
    await open(scene, "Long reading session", questionMarker("long-reading", 1));
    sameHeight(watched, before, topOf(scene, watched));

    await type(composer(scene), fresh);
    await click(control(chat(scene), "button", "Send"));
    await waitFor(() =>
      assert.deepEqual(
        scene.external.prompts(),
        [{ sessionId: "long-reading", message: fresh }],
        "the question was sent",
      ),
    );
    await scene.settled();

    const top = topOf(scene, fresh);
    assert.ok(Math.abs(top - 16) <= ONE_LINE, `the sent question sits 16px below the top of the view (${top}px)`);
  },
);
