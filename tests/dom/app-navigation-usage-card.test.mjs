import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  act,
  dom,
  waitFor,
  restoreGlobals,
} from "../support/app-navigation.mjs";

after(restoreGlobals);

const CONTEXT_WINDOW = 10_000;

const chat = (scene) => control(scene.container, "region", "Chat");
const usageButton = (scene) => control(scene.container, "button", "View context and cost");

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

async function recordUsage(scene, sessionId, { cost, percent }) {
  const detail = await scene.external.host.call("sessions.get", { id: sessionId });
  const tokens = (percent * CONTEXT_WINDOW) / 100;
  detail.stats = {
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 1,
    toolResults: 1,
    totalMessages: 3,
    tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens },
    cost,
  };
  detail.agentState = {
    running: true,
    state: { isStreaming: true, contextUsage: { percent, contextWindow: CONTEXT_WINDOW, tokens } },
  };
  scene.external.replaceConversation(sessionId, detail);
}

test("opening the usage card from the top bar of an open conversation names the model that conversation uses", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(scene.container, "Personal conversation marker"));
  await click(control(scene.container, "button", "View context and cost"));
  const card = await waitFor(() => control(scene.container, "region", "Context and cost"));
  await waitFor(() => visibleText(card, "fixture-model"));
});

test("while a brand-new conversation is still answering, the usage button shows the cost and context share the Host has recorded so far", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await type(await waitFor(() => control(chat(scene), "textbox")), "Plan the release");
  await click(control(chat(scene), "button", "Send"));
  await waitFor(() => assert.equal(scene.external.prompts().length, 1));
  const sessionId = scene.external.prompts()[0].sessionId;
  await waitFor(() => assert.ok(scene.external.agentSubscribers(sessionId) > 0));
  await act(async () => scene.external.agentEvent(sessionId, { type: "agent_start" }));

  await recordUsage(scene, sessionId, { cost: 0.03, percent: 25 });
  await act(async () => scene.external.updateSession(sessionId, {}));
  await scene.settled();

  assert.match(usageButton(scene).textContent, /\$0\.03/, "the cost recorded so far is shown");
  assert.match(usageButton(scene).textContent, /25%/, "the context share recorded so far is shown");
});

test("a change to another conversation leaves the usage shown for the open conversation as it was", async (t) => {
  const scene = await startNavigation(t, { initialSession: "personal-history" });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  await recordUsage(scene, "personal-history", { cost: 0.03, percent: 25 });
  await act(async () => scene.external.updateSession("personal-history", {}));
  await waitFor(() => assert.match(usageButton(scene).textContent, /\$0\.03/));

  await recordUsage(scene, "personal-history", { cost: 0.5, percent: 80 });
  await act(async () => scene.external.updateSession("personal-other", {}));
  await scene.settled();

  assert.match(usageButton(scene).textContent, /\$0\.03/, "the open conversation's cost is unchanged");
  assert.match(usageButton(scene).textContent, /25%/, "the open conversation's context share is unchanged");
});
