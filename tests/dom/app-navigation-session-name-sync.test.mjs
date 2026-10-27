import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  startNavigation,
  control,
  visibleText,
  click,
  hover,
  input,
  keyDown,
  act,
  dom,
  waitFor,
  historyRow,
  restoreGlobals,
} from "../support/app-navigation.mjs";

after(restoreGlobals);

const FIRST_MESSAGE = "Draft the quarterly summary";
const OLD_NAME = "Personal release notes";
const NEW_NAME = "Renamed elsewhere";
const chat = (scene) => control(scene.container, "region", "Chat");

function title(scene) {
  return control(scene.container, "heading").textContent.trim();
}

async function type(composer, value) {
  await act(async () => {
    composer.focus();
    composer.textContent = value;
    const range = dom.window.document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    dom.window.getSelection().removeAllRanges();
    dom.window.getSelection().addRange(range);
    composer.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }));
  });
}

async function sendFirstMessage(scene) {
  await click(control(scene.navigation(), "button", scene.labels.newSession));
  await type(await waitFor(() => control(chat(scene), "textbox")), FIRST_MESSAGE);
  await click(control(chat(scene), "button", "Send"));
  return waitFor(() => {
    const [sent] = scene.external.prompts();
    assert.ok(sent, "the first message reached the Host");
    return sent.sessionId;
  });
}

async function openActions(scene, rowName) {
  await hover(await waitFor(() => control(scene.history(), "button", rowName)));
  await click(control(scene.history(), "button", `Session actions for ${rowName}`));
  return waitFor(() => control(scene.history(), "menu", "Session actions"));
}

async function renameElsewhere(scene, sessionId = "personal-history") {
  await act(async () => scene.external.updateSession(sessionId, { name: NEW_NAME }));
}

async function openConversation(t, options = {}) {
  const scene = await startNavigation(t, { initialSession: "personal-history", ...options });
  await waitFor(() => visibleText(chat(scene), "Personal conversation marker"));
  return scene;
}

test("when the Host names a new conversation, that conversation's title shows the generated name without switching away", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Sidebar context menu" });
  const sessionId = await sendFirstMessage(scene);
  await waitFor(() => historyRow(scene, "Sidebar context menu"));
  await waitFor(() => assert.equal(title(scene), "Sidebar context menu"));
  assert.equal(dom.window.location.search, `?session=${sessionId}`, "the same conversation stayed open");
  visibleText(chat(scene), FIRST_MESSAGE);
});

test("when a rename is saved from the open conversation's history row, the title shows the new name", async (t) => {
  const scene = await openConversation(t);
  const menu = await openActions(scene, OLD_NAME);
  await click(control(menu, "menuitem", "Rename"));
  const field = await waitFor(() => control(scene.history(), "textbox"));
  await input(field, "Weekly report draft");
  await keyDown(field, "Enter");
  await waitFor(() => historyRow(scene, "Weekly report draft"));
  await waitFor(() => assert.equal(title(scene), "Weekly report draft"));
});

test("when a name is regenerated for the open conversation, the title shows it as soon as the history row does", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Weekly standup notes" });
  dom.window.localStorage.setItem(
    "dexon:sessionNamingModel",
    JSON.stringify({ provider: "deepseek", modelId: "deepseek-chat" }),
  );
  const menu = await openActions(scene, OLD_NAME);
  await click(control(menu, "menuitem", "Regenerate name"));
  await waitFor(() => historyRow(scene, "Weekly standup notes"));
  assert.equal(title(scene), "Weekly standup notes");
});

test("when /name renames the open conversation, the title shows the new name", async (t) => {
  const scene = await openConversation(t);
  await type(await waitFor(() => control(chat(scene), "textbox")), "/name Release brief");
  await click(control(chat(scene), "button", "Send"));
  await waitFor(() => historyRow(scene, "Release brief"));
  await waitFor(() => assert.equal(title(scene), "Release brief"));
});

test("when another window renames the open conversation, the title shows the new name", async (t) => {
  const scene = await openConversation(t);
  await renameElsewhere(scene);
  await waitFor(() => historyRow(scene, NEW_NAME));
  assert.equal(title(scene), NEW_NAME);
});

test("when another window renames the open conversation, the Context and cost card names it with the new name", async (t) => {
  const scene = await openConversation(t);
  await renameElsewhere(scene);
  await waitFor(() => historyRow(scene, NEW_NAME));
  await click(control(scene.container, "button", "View context and cost"));
  const card = await waitFor(() => control(scene.container, "region", "Context and cost"));
  await click(control(card, "button", "Details"));
  await waitFor(() => {
    assert.equal(card.textContent.includes(OLD_NAME), false, `the card still shows "${OLD_NAME}"`);
    assert.ok(card.textContent.includes(NEW_NAME), `the card should show "${NEW_NAME}"`);
  });
});

test("after /session has shown the usage card, a later rename still shows the new name on the card", async (t) => {
  const scene = await openConversation(t);
  await type(await waitFor(() => control(chat(scene), "textbox")), "/session");
  await click(control(chat(scene), "button", "Send"));
  await waitFor(() => control(scene.container, "region", "Context and cost"));
  await click(control(scene.container, "button", "View context and cost"));
  await waitFor(() => assert.equal(scene.container.querySelector('[aria-label="Context and cost"]'), null));
  await renameElsewhere(scene);
  await waitFor(() => historyRow(scene, NEW_NAME));
  await click(control(scene.container, "button", "View context and cost"));
  const card = await waitFor(() => control(scene.container, "region", "Context and cost"));
  await click(control(card, "button", "Details"));
  await waitFor(() => {
    assert.equal(card.textContent.includes(OLD_NAME), false, `the card still shows "${OLD_NAME}"`);
    assert.ok(card.textContent.includes(NEW_NAME), `the card should show "${NEW_NAME}"`);
  });
});

test("when a browser authorization request arrives for the renamed conversation, the dialog names it with the new name", async (t) => {
  const scene = await openConversation(t);
  await renameElsewhere(scene);
  await waitFor(() => historyRow(scene, NEW_NAME));
  await act(async () =>
    scene.external.browserEvent({
      type: "agent-authorization-request",
      request: {
        id: "renamed-session-authorization",
        sessionId: "personal-history",
        source: "local",
        minimumPermission: "read",
        createdAt: 1,
        expiresAt: 30001,
      },
    }),
  );
  const dialog = await waitFor(() => control(scene.container, "dialog"));
  await waitFor(() => {
    assert.equal(dialog.textContent.includes(OLD_NAME), false, `the dialog still shows "${OLD_NAME}"`);
    assert.ok(dialog.textContent.includes(NEW_NAME), `the dialog should show "${NEW_NAME}"`);
  });
});

test("when the sidebar is hidden, the Host's name for a new conversation still reaches the title", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Sidebar context menu" });
  await click(control(scene.navigation(), "button", "Hide sidebar"));
  await waitFor(() => control(scene.navigation(), "button", "Show sidebar"));
  const held = scene.external.hold("agent.generateTitle");
  await sendFirstMessage(scene);
  await waitFor(() => assert.ok(held.reached(), "the title request is still pending"));
  control(scene.navigation(), "button", "Show sidebar");
  await act(async () => held.release());
  await waitFor(() => assert.equal(title(scene), "Sidebar context menu"));
});

test("when a different conversation is renamed, the open conversation keeps showing its own name", async (t) => {
  const scene = await openConversation(t);
  await renameElsewhere(scene, "personal-other");
  await waitFor(() => historyRow(scene, NEW_NAME));
  assert.equal(title(scene), OLD_NAME);
});

test("when a name is generated for a conversation the user has left, only that conversation's history row changes", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Sidebar context menu" });
  const held = scene.external.hold("agent.generateTitle");
  await sendFirstMessage(scene);
  await waitFor(() => assert.ok(held.reached(), "the title request is still pending"));
  await click(control(scene.history(), "button", "Another personal conversation"));
  await waitFor(() => visibleText(chat(scene), "Other conversation marker"));
  await act(async () => held.release());
  await waitFor(() => historyRow(scene, "Sidebar context menu"));
  await waitFor(() => assert.equal(title(scene), "Another personal conversation"));
});

test("while a new conversation is still being named, the title shows its first message", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Sidebar context menu" });
  const held = scene.external.hold("agent.generateTitle");
  const sessionId = await sendFirstMessage(scene);
  await waitFor(() => assert.ok(held.reached(), "the title request is still pending"));
  assert.equal(title(scene), FIRST_MESSAGE);
  assert.notEqual(title(scene), sessionId, "the title is not the session id");
});

test("when the Host names nothing, the new conversation keeps its first message as the title", async (t) => {
  const scene = await openConversation(t);
  const sessionId = await sendFirstMessage(scene);
  await scene.settled();
  assert.equal(title(scene), FIRST_MESSAGE);
  assert.notEqual(title(scene), sessionId, "the title is not the session id");
});

test("while a new conversation is still being named, the title does not announce naming", async (t) => {
  const scene = await openConversation(t, { generatedTitle: "Sidebar context menu" });
  const held = scene.external.hold("agent.generateTitle");
  await sendFirstMessage(scene);
  await waitFor(() => assert.ok(held.reached(), "the title request is still pending"));
  assert.doesNotMatch(title(scene), /Naming/, "the title stays the conversation's own text");
});
