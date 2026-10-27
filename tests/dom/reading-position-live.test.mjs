import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  act,
  click,
  control,
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
const VIEW_HEIGHT = 600;

const line = (number) => `Streamed line ${String(number).padStart(2, "0")} of long-reading`;
const STREAM_LINES = [1, 2, 3, 4, 5, 6].map(line);

const chat = (scene) => control(scene.container, "region", "Chat");

async function open(scene, title, sentence) {
  await click(historyRow(scene, title));
  await waitFor(() => visibleText(chat(scene), sentence));
  await scene.settled();
}

function streamedMessage(lines) {
  return {
    role: "assistant",
    content: [{ type: "text", text: lines.join("\n\n") }],
    provider: "navigation-fixture",
  };
}

async function streamingScene(t, { lines = [line(1)] } = {}) {
  const first = readingConversation("long-reading", { name: "Long reading session", turns: 12, pageTurns: 12 });
  first.agentState = { running: true, state: { isStreaming: true, streamingMessage: streamedMessage(lines) } };
  const second = readingConversation("long-second", { name: "Second reading session", turns: 12, pageTurns: 12 });
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: [...markersOf(first, second), ...STREAM_LINES] });
  return scene;
}

async function idleScene(t) {
  const first = readingConversation("long-reading", { name: "Long reading session", turns: 12, pageTurns: 12 });
  const second = readingConversation("long-second", { name: "Second reading session", turns: 12, pageTurns: 12 });
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, {
    markers: [...markersOf(first, second), questionMarker("long-reading", 13), answerMarker("long-reading", 13)],
  });
  return { scene, second };
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

async function expectTheWayBackToTheNewestContent(scene) {
  const offered = () => roles(chat(scene), "button", "Scroll to bottom").length;
  await waitFor(() => assert.equal(offered(), 1, "the reader is offered the way back to the newest content"));
  return roles(chat(scene), "button", "Scroll to bottom")[0];
}

test("a reply that grows while the reader is away does not pull the conversation to the newest content when the reader returns", async (t) => {
  const scene = await streamingScene(t);
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  sameHeight(watched, before, topOf(scene, watched));
  await expectTheWayBackToTheNewestContent(scene);
});

test("after returning, the scroll-to-bottom button jumps to the newest content and following resumes", async (t) => {
  const scene = await streamingScene(t);
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  sameHeight(watched, before, topOf(scene, watched));

  await click(await expectTheWayBackToTheNewestContent(scene));
  assert.equal(distanceFromBottom(scene), 0, "clicking it shows the newest content");

  await scene.external.streamReply("long-reading", [line(1), line(2), line(3), line(4), line(5)].join("\n\n"));
  await scene.settled();
  assert.equal(distanceFromBottom(scene), 0, "the view keeps following the growing reply after the jump");
});

test("after returning to the earlier position, the background reply finishing does not pull the view to the bottom", async (t) => {
  const scene = await streamingScene(t);
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  sameHeight(watched, before, topOf(scene, watched));

  await act(async () => scene.external.finishStream("long-reading", [line(1), line(2), line(3), line(4)].join("\n\n")));
  await scene.settled();

  sameHeight(watched, before, topOf(scene, watched));
  const below = distanceFromBottom(scene);
  assert.ok(below > 0, `the finished reply stays below the sentence the reader returned to (${below}px)`);
});

test("when the message that was being read is gone and a reply is running, returning lands at the latest message and keeps following the reply", async (t) => {
  const running = () => ({ running: true, state: { isStreaming: true, streamingMessage: streamedMessage([line(1)]) } });
  const first = readingConversation("long-reading", { name: "Long reading session", turns: 12, pageTurns: 12 });
  first.agentState = running();
  const second = readingConversation("long-second", { name: "Second reading session", turns: 12, pageTurns: 12 });
  const rewritten = readingConversation("long-reading", {
    name: "Long reading session",
    turns: 12,
    pageTurns: 12,
    wording: "Rewritten",
  });
  rewritten.agentState = running();
  const scene = await startSessionScene(t, [first, second]);
  installChatGeometry(t, { markers: [...markersOf(first, second), ...markersOf(rewritten), ...STREAM_LINES] });

  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  await readUpTo(scene, answerMarker("long-reading", 3), 1000);
  await open(scene, "Second reading session", questionMarker("long-second", 1));
  scene.external.replaceConversation("long-reading", rewritten);
  await open(scene, "Long reading session", "Rewritten question 01 of long-reading");

  assert.equal(distanceFromBottom(scene), 0, "the reader lands at the latest message of the running reply");

  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();
  assert.equal(distanceFromBottom(scene), 0, "the view keeps following the running reply");
});

test("a reader who left while watching a reply that finished while they were away returns to the same sentence with the way to the bottom offered", async (t) => {
  const scene = await streamingScene(t, { lines: [line(1), line(2)] });
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 12);
  const before = topOf(scene, watched);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  await act(async () => scene.external.finishStream("long-reading", STREAM_LINES.join("\n\n")));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  sameHeight(watched, before, topOf(scene, watched));
  const below = distanceFromBottom(scene);
  assert.ok(below > 0, `the finished reply is below the sentence the reader was watching (${below}px)`);
  await expectTheWayBackToTheNewestContent(scene);
});

test("a reader who left while watching the reply at the bottom returns to the sentence they were watching, with the new content below", async (t) => {
  const scene = await streamingScene(t, { lines: [line(1), line(2)] });
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 12);
  const before = topOf(scene, watched);
  assert.ok(
    before >= 0 && before < VIEW_HEIGHT,
    `“${watched}” is on screen while the reply arrives (${before}px below the top)`,
  );

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  await scene.external.streamReply("long-reading", [line(1), line(2), line(3), line(4), line(5)].join("\n\n"));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  sameHeight(watched, before, topOf(scene, watched));
  const below = distanceFromBottom(scene);
  assert.ok(below > 0, `the new lines of the reply are below the sentence the reader was watching (${below}px)`);
  await expectTheWayBackToTheNewestContent(scene);
});

test("a turn that arrives through another channel while the reader is away does not move the reading position", async (t) => {
  const { scene } = await idleScene(t);
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const watched = answerMarker("long-reading", 3);
  const before = await readUpTo(scene, watched, 1000);

  await open(scene, "Second reading session", questionMarker("long-second", 1));
  scene.external.appendTurn("long-reading", questionMarker("long-reading", 13), answerMarker("long-reading", 13));
  await scene.settled();
  await open(scene, "Long reading session", questionMarker("long-reading", 1));

  sameHeight(watched, before, topOf(scene, watched));
  await expectTheWayBackToTheNewestContent(scene);
});

test("while the reader stays at the bottom of a running reply, the view keeps following it", async (t) => {
  const scene = await streamingScene(t, { lines: [line(1)] });
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  assert.equal(distanceFromBottom(scene), 0, "the reader starts at the bottom of the reply");

  await scene.external.streamReply("long-reading", [line(1), line(2)].join("\n\n"));
  await scene.settled();
  assert.equal(distanceFromBottom(scene), 0, "the view follows the reply as it grows");

  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();
  assert.equal(distanceFromBottom(scene), 0, "the view keeps following every new line of the reply");
});

test("scrolling up during a running reply stops the view from following", async (t) => {
  const scene = await streamingScene(t, { lines: [line(1)] });
  await open(scene, "Long reading session", questionMarker("long-reading", 1));
  const container = conversation(scene);
  await readerScrollsTo(scene, container.scrollHeight - container.clientHeight - 400);
  const watched = answerMarker("long-reading", 3);
  const before = topOf(scene, watched);

  await scene.external.streamReply("long-reading", [line(1), line(2), line(3)].join("\n\n"));
  await scene.settled();

  sameHeight(watched, before, topOf(scene, watched));
  assert.ok(distanceFromBottom(scene) > 0, "the reader has stayed where they scrolled to");
});
