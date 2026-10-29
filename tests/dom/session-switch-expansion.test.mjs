import assert from "node:assert/strict";
import test, { after } from "node:test";
import { click, control, historyRow, restoreGlobals, visibleText, waitFor } from "../support/app-navigation.mjs";
import { startSessionScene } from "../support/session-tree-scene.mjs";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import { assistantReply, readStep, textBlock, thinkingBlock, toolOutput } from "../fixtures/chat-answer-turn.mjs";
import { navigationPaths } from "../fixtures/app-navigation-data.mjs";

after(restoreGlobals);

function conversationShowing(id, name) {
  const messages = [
    { role: "user", content: `Question of ${id}`, timestamp: 1 },
    assistantReply(
      [thinkingBlock(`Trace one of ${id}`), thinkingBlock(`Trace two of ${id}`), readStep("call-1", "config.json")],
      "toolUse",
      2,
    ),
    toolOutput("call-1", "ok", 3),
    assistantReply([thinkingBlock(`Trace three of ${id}`), textBlock(`Answer of ${id}`)], "stop", 4),
  ];
  const detail = createSessionDetail(id, {
    cwd: navigationPaths.personal,
    messages,
    entryIds: messages.map((_message, index) => `${id}-entry-${index}`),
    name,
  });
  Object.assign(detail.info, {
    projectRoot: navigationPaths.personal,
    created: "2026-08-02T08:00:00.000Z",
    modified: "2026-09-07T10:00:00.000Z",
    firstMessage: `Question of ${id}`,
    messageCount: messages.length,
  });
  detail.context.loadedMessages = messages.length;
  return detail;
}

test("after opening and closing parts of one conversation and reading another one, coming back shows every part as the reader left it", async (t) => {
  const scene = await startSessionScene(t, [
    conversationShowing("switch-a", "Expansion A session"),
    conversationShowing("switch-b", "Expansion B session"),
  ]);
  const chat = () => control(scene.container, "region", "Chat");
  const rows = (pattern) =>
    [...chat().querySelectorAll("button[aria-expanded]")].filter((node) => pattern.test(node.textContent));
  const asText = (nodes) => nodes.map((node) => (node.getAttribute("aria-expanded") === "true" ? "open" : "closed"));
  const state = () => ({
    group: asText(rows(/Processed/)),
    thinking: asText(rows(/Deep thinking/)),
    tool: asText(rows(/config\.json/)),
  });
  const read = async (title, marker) => {
    await click(historyRow(scene, title));
    await waitFor(() => visibleText(chat(), marker));
    await scene.settled();
  };
  const tap = async (pattern) => {
    await click(rows(pattern)[0]);
    await scene.settled();
  };

  await read("Expansion A session", "Answer of switch-a");
  await tap(/Processed/);
  await tap(/Trace one of switch-a/);
  await tap(/Trace three of switch-a/);
  await tap(/Trace three of switch-a/);
  await tap(/config\.json/);
  assert.deepEqual(
    state(),
    { group: ["open"], thinking: ["open", "closed", "closed"], tool: ["open"] },
    "one trace opened, one untouched, one opened and closed again, the tool row opened",
  );

  await read("Expansion B session", "Answer of switch-b");
  assert.equal(rows(/Trace one of switch-a/).length, 0, "the other conversation is the one on screen");
  await read("Expansion A session", "Answer of switch-a");

  assert.deepEqual(
    state(),
    { group: ["open"], thinking: ["open", "closed", "closed"], tool: ["open"] },
    "coming back finds the same parts open, closed and untouched",
  );
});
