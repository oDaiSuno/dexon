import assert from "node:assert/strict";
import test, { after } from "node:test";
import { byRole, click, restoreGlobals, text } from "../support/renderer.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import {
  MID_TURN_ANSWER,
  MID_TURN_PREAMBLE,
  MID_TURN_QUESTION,
  MID_TURN_TOOL_OUTPUT,
  pagesHost,
  splitTurnHistory,
} from "../fixtures/chat-history-pages.mjs";
import { openConversation } from "../support/session-reading-scene.mjs";

after(restoreGlobals);

const messagesArea = (view) => byRole(view.container, "group", "Messages");
const earlierArea = (view) => byRole(view.container, "group", "Earlier messages");
const occurrences = (view, value) => messagesArea(view).textContent.split(value).length - 1;

function readOrder(view, values) {
  const content = messagesArea(view).textContent;
  const positions = values.map((value) => content.indexOf(value));
  values.forEach((value, index) => assert.notEqual(positions[index], -1, `“${value}” is on screen`));
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index], `“${values[index]}” is read after “${values[index - 1]}”`);
  }
}

test("when a page starts in the middle of a turn, its reply is readable and the whole turn settles into one order once the earlier part arrives", async (t) => {
  const { detail, pages } = splitTurnHistory();
  const host = createSessionTestHost({ getSession: async () => detail, ...pagesHost(pages) });
  const scene = await openConversation(t, { host, props: { session: detail.info } });

  await scene.settle(() => assert.ok(text(messagesArea(scene.view), MID_TURN_ANSWER)));
  assert.equal(
    occurrences(scene.view, MID_TURN_ANSWER),
    1,
    "the reply of a page that begins mid-turn is readable exactly once",
  );

  await scene.signalInView(earlierArea(scene.view));
  await scene.settle(() => assert.ok(text(messagesArea(scene.view), MID_TURN_QUESTION)));

  for (const value of [MID_TURN_QUESTION, MID_TURN_PREAMBLE, MID_TURN_ANSWER]) {
    assert.equal(occurrences(scene.view, value), 1, `“${value}” appears exactly once once the page is joined`);
  }
  readOrder(scene.view, [MID_TURN_QUESTION, MID_TURN_PREAMBLE, MID_TURN_ANSWER]);

  const root = messagesArea(scene.view);
  const groups = [...root.querySelectorAll("button[aria-expanded]")].filter((node) =>
    /process details|processed/i.test(node.textContent),
  );
  assert.equal(groups.length, 1, "the tool call of the joined turn keeps one group of its own");
  await click(groups[0]);
  const toolRow = byRole(root, "button", /Read.*parser\.ts/);
  assert.ok(toolRow, "the tool call is readable once its page has arrived");
  await click(toolRow);
  assert.ok(text(root, MID_TURN_TOOL_OUTPUT), "the tool result is shown with the call that produced it");
});
