import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  roles,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  historyRowsWithStatus,
  historyRow,
  restoreGlobals,
} from "../support/app-navigation.mjs";

after(restoreGlobals);

const chat = (scene) => control(scene.container, "region", "Chat");
const composer = (scene) => control(chat(scene), "textbox");

async function backToChat(scene, title) {
  await click(historyRow(scene, title));
  return waitFor(() => chat(scene));
}

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

function streamed(text) {
  return {
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text }], provider: "navigation-fixture" },
  };
}

async function streamingConversation(t) {
  const scene = await startNavigation(t, {
    initialSession: "personal-history",
    streamingSessionId: "personal-history",
  });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await waitFor(() => assert.ok(scene.external.agentSubscribers("personal-history") > 0, "the chat follows the run"));
  return scene;
}

test("a reply that keeps streaming while Resources is open is shown in full, still stoppable, when the user returns to Chat", async (t) => {
  const scene = await streamingConversation(t);
  await act(async () => scene.external.agentEvent("personal-history", streamed("First streamed sentence.")));
  await waitFor(() => visibleText(chat(scene), "First streamed sentence."));
  await scene.resources();
  await act(async () =>
    scene.external.agentEvent(
      "personal-history",
      streamed("First streamed sentence. Second sentence arrived while Resources was open."),
    ),
  );
  await scene.settled();
  await backToChat(scene, "Personal release notes");
  await waitFor(() =>
    visibleText(chat(scene), "First streamed sentence. Second sentence arrived while Resources was open."),
  );
  control(chat(scene), "button", "Stop agent");
  assert.deepEqual(scene.external.stopRequests(), [], "visiting Resources did not stop the running task");
});

test("a round trip through Resources keeps the same conversation attached instead of opening it again", async (t) => {
  const scene = await streamingConversation(t);
  await scene.settled();
  const reads = scene.external.sessionReads("personal-history");
  await scene.resources();
  await scene.settled();
  assert.ok(scene.external.agentSubscribers("personal-history") > 0, "the hidden chat still follows the run");
  await backToChat(scene, "Personal release notes");
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await scene.settled();
  assert.equal(scene.external.sessionReads("personal-history"), reads, "returning did not load the conversation again");
});

test("clicking the conversation already open on the Chat page keeps it attached instead of loading it again", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await type(composer(scene), "Draft typed before clicking the open row");
  await scene.settled();
  const reads = scene.external.sessionReads("personal-history");
  await click(historyRow(scene, "Personal release notes"));
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await scene.settled();
  assert.equal(scene.external.sessionReads("personal-history"), reads, "the conversation was not loaded again");
  assert.equal(dom.window.location.search, "?session=personal-history");
  assert.equal(composer(scene).textContent, "Draft typed before clicking the open row");
});

test("a selected conversation that finishes while Resources is open is marked as new activity until Chat shows it again", async (t) => {
  const scene = await streamingConversation(t);
  await waitFor(() => assert.equal(historyRowsWithStatus(scene, "Personal release notes", "Agent running").length, 1));
  await scene.resources();
  await act(async () => scene.external.finishStream("personal-history", "Final answer written in the background"));
  await waitFor(() => assert.equal(historyRowsWithStatus(scene, "Personal release notes", "New activity").length, 1));
  assert.equal(historyRowsWithStatus(scene, "Another personal conversation", "New activity").length, 0);
  await backToChat(scene, "Personal release notes");
  await waitFor(() => visibleText(chat(scene), "Final answer written in the background"));
  await waitFor(() => assert.equal(historyRowsWithStatus(scene, "Personal release notes", "New activity").length, 0));
});

test("a conversation that finishes while its chat is on screen is not marked as new activity", async (t) => {
  const scene = await streamingConversation(t);
  await waitFor(() => assert.equal(historyRowsWithStatus(scene, "Personal release notes", "Agent running").length, 1));
  await act(async () => scene.external.finishStream("personal-history", "Final answer read as it arrived"));
  await waitFor(() => visibleText(chat(scene), "Final answer read as it arrived"));
  await scene.settled();
  assert.equal(historyRowsWithStatus(scene, "Personal release notes", "New activity").length, 0);
});

test("an unsent draft survives a visit to Resources and is what gets sent, and the hidden chat cannot be reached meanwhile", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await type(composer(scene), "Draft written before visiting Resources");
  await scene.resources();
  assert.equal(roles(scene.container, "region", "Chat").length, 0, "the chat is not exposed behind Resources");
  assert.equal(roles(scene.container, "group", "Message input").length, 0, "the composer is not reachable");
  await backToChat(scene, "Personal release notes");
  assert.equal(dom.window.location.search, "?session=personal-history");
  await click(control(chat(scene), "button", "Send"));
  await waitFor(() =>
    assert.deepEqual(scene.external.prompts(), [
      { sessionId: "personal-history", message: "Draft written before visiting Resources" },
    ]),
  );
});

test("expanded process details in the conversation stay expanded after a visit to Resources", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-tools", toolHistory: true });
  await waitFor(() => visibleText(chat(scene), "Tool answer marker"));
  const toggle = () => control(chat(scene), "button", /process details/i);
  assert.equal(toggle().getAttribute("aria-expanded"), "false");
  await click(toggle());
  await waitFor(() => assert.equal(toggle().getAttribute("aria-expanded"), "true"));
  await scene.resources();
  await backToChat(scene, "Personal tool conversation");
  await waitFor(() => visibleText(chat(scene), "Tool answer marker"));
  assert.equal(toggle().getAttribute("aria-expanded"), "true");
});
