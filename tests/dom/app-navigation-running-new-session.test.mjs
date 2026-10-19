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
  restoreGlobals,
} from "../support/app-navigation.mjs";
import { accessibleName } from "../support/dom-queries.mjs";

after(restoreGlobals);

const firstMessage = "Draft the quarterly summary";
const chat = (scene) => control(scene.container, "region", "Chat");

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

function rowsFor(scene, title) {
  return roles(scene.history(), "button").filter((element) => {
    const name = accessibleName(element);
    return name.includes(title) && !name.startsWith("Session actions");
  });
}

function onlyRow(scene, title) {
  const rows = rowsFor(scene, title);
  assert.equal(rows.length, 1, `Expected one history row for ${title}; found ${rows.length}`);
  return rows[0];
}

async function sendFirstMessage(scene) {
  await click(control(scene.navigation(), "button", /^new session$/i));
  const composer = await waitFor(() => control(chat(scene), "textbox"));
  await type(composer, firstMessage);
  await click(control(chat(scene), "button", "Send"));
  await waitFor(() => assert.equal(scene.external.prompts().length, 1, "the first message reached the Host"));
  return scene.external.prompts()[0].sessionId;
}

async function startedElsewhere(t) {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  const sessionId = await sendFirstMessage(scene);
  await waitFor(() => assert.ok(scene.external.agentSubscribers(sessionId) > 0, "the new chat follows its run"));
  await act(async () => scene.external.streamReply(sessionId, "Summary reply so far"));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far"));
  await click(control(scene.history(), "button", "Personal release notes"));
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  return { scene, sessionId };
}

test("leaving a new conversation mid-reply and opening it from history shows the sent message and the reply so far", async (t) => {
  const { scene, sessionId } = await startedElsewhere(t);
  assert.doesNotMatch(chat(scene).textContent, /Summary reply so far/, "the other conversation is on screen");
  await click(await waitFor(() => onlyRow(scene, firstMessage)));
  await waitFor(() => visibleText(chat(scene), firstMessage));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far"));
  assert.equal(dom.window.location.search, `?session=${sessionId}`);
  assert.doesNotMatch(chat(scene).textContent, /Personal conversation marker/);
  control(chat(scene), "button", "Stop agent");
});

test("after returning to the new conversation, later reply text keeps appearing and the first message is shown once", async (t) => {
  const { scene, sessionId } = await startedElsewhere(t);
  await click(await waitFor(() => onlyRow(scene, firstMessage)));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far"));
  await waitFor(() => assert.ok(scene.external.agentSubscribers(sessionId) > 0, "the reopened chat follows the run"));
  await act(async () => scene.external.streamReply(sessionId, "Summary reply so far, now with its second half."));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far, now with its second half."));
  await act(async () => scene.external.finishStream(sessionId, "Summary reply so far, now with its second half."));
  await scene.settled();
  const sent = [...chat(scene).querySelectorAll("*")].filter(
    (element) =>
      element.textContent.trim() === firstMessage &&
      ![...element.children].some((child) => child.textContent.trim() === firstMessage),
  );
  assert.equal(sent.length, 1, "the first message is not duplicated");
  assert.equal(rowsFor(scene, firstMessage).length, 1, "the finished conversation still has one history row");
});

test("a slow reply for the conversation the user just left cannot replace the new conversation they returned to", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  const sessionId = await sendFirstMessage(scene);
  await waitFor(() => assert.ok(scene.external.agentSubscribers(sessionId) > 0));
  await act(async () => scene.external.streamReply(sessionId, "Summary reply so far"));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far"));
  const slowOld = scene.external.hold("sessions.get", (params) => params.id === "personal-other");
  await click(control(scene.history(), "button", "Another personal conversation"));
  await waitFor(() => assert.ok(slowOld.reached(), "the old conversation is still loading"));
  await click(await waitFor(() => onlyRow(scene, firstMessage)));
  await waitFor(() => visibleText(chat(scene), "Summary reply so far"));
  slowOld.release();
  await scene.settled();
  assert.equal(dom.window.location.search, `?session=${sessionId}`);
  visibleText(chat(scene), firstMessage);
  visibleText(chat(scene), "Summary reply so far");
  assert.doesNotMatch(chat(scene).textContent, /Other conversation marker/);
});

test("a new chat that has only an unsent draft does not appear in history and keeps its draft", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await click(control(scene.navigation(), "button", /^new session$/i));
  await type(await waitFor(() => control(chat(scene), "textbox")), "Unsent draft line");
  await click(control(scene.history(), "button", "Personal release notes"));
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await scene.settled();
  assert.equal(rowsFor(scene, "Unsent draft line").length, 0);
  assert.equal(roles(scene.history(), "listitem").length, 2);
  await click(control(scene.navigation(), "button", /^new session$/i));
  await waitFor(() => assert.equal(control(chat(scene), "textbox").textContent, "Unsent draft line"));
  assert.deepEqual(scene.external.prompts(), [], "nothing was sent");
});
