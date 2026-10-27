import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createDeferred } from "#test-timing";
import { accessibleName, allByRole } from "../support/dom-queries.mjs";
import { act, byRole, click, dom, hover, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";
import { FOLLOW_UP_QUESTION, OPENING, twoAnsweredTurns } from "../fixtures/chat-answer-turn.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc, setAppLanguage } = await loadRenderer(
  "message-action-names",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(restoreGlobals);

const ENGLISH = "en-US";
const CHINESE = "zh-CN";
const MESSAGES = { [ENGLISH]: "Messages", [CHINESE]: "消息" };

const nameOf = (element) => accessibleName(element) || element.getAttribute("title") || "";

function isShown(element) {
  for (let current = element; current; current = current.parentElement) {
    const style = dom.window.getComputedStyle(current);
    if (current.hidden || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
  }
  return true;
}

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

function messagesOf(view, language) {
  const area = byRole(view.container, "group", MESSAGES[language]);
  assert.ok(area, "the conversation shows its message area");
  return area;
}

function onScreen(view, language, value) {
  const node = text(messagesOf(view, language), value);
  assert.ok(node, `“${value}” is readable as ordinary reply text`);
  return node;
}

function buttonsOf(view, language) {
  return allByRole(messagesOf(view, language), "button");
}

function buttonsNamed(view, language, name) {
  return buttonsOf(view, language).filter((node) => nameOf(node) === name);
}

function shownButtonsNamed(view, language, name) {
  return buttonsNamed(view, language, name).filter(isShown);
}

function answerActionsOf(view, language) {
  return buttonsOf(view, language).filter((node) => node.classList.contains("message-hover-action"));
}

function shownEnglishNames(view, language) {
  return buttonsOf(view, language)
    .filter(isShown)
    .map((node) => nameOf(node))
    .filter((name) => name !== "" && /[A-Za-z]/.test(name));
}

function assertIconOnly(control, name) {
  assert.equal(control.textContent.trim(), "", `the control named ${name} shows no text at all`);
  assert.equal(
    control.getAttribute("title"),
    control.getAttribute("aria-label"),
    `the control named ${name} is read by a screen reader exactly as the tooltip spells it`,
  );
}

async function mountConversation(t, detail, options = {}) {
  const language = options.language ?? ENGLISH;
  setAppLanguage(language);
  t.after(() => setAppLanguage(ENGLISH));
  const host = createSessionTestHost({
    getSession: async () => detail,
    sendAgentCommand: async (sid, payload) => (payload.type === "fork" ? options.answerFork?.(sid, payload) : {}),
  });
  dom.window.piBridge = {};
  const boundary = installApiHostBridge(dom.window, () => host, resetRpc);
  let view;
  t.after(async () => {
    try {
      await view?.unmount();
    } finally {
      boundary.close();
    }
  });
  view = await mount(t, ChatWindow, {
    session: detail.info,
    newSessionCwd: null,
    onSessionForked: () => {},
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  return { view, host, language };
}

test("when the interface is in Chinese and the reader points at a later question, its footer offers only a copy icon named 复制消息 and a pencil icon named 从这里编辑", async (t) => {
  const { view, language } = await mountConversation(t, twoAnsweredTurns(), { language: CHINESE });
  await hover(onScreen(view, language, FOLLOW_UP_QUESTION));
  const pencils = shownButtonsNamed(view, language, "从这里编辑");
  assert.equal(pencils.length, 1, "the question the reader points at offers the one revealed pencil");
  const copies = shownButtonsNamed(view, language, "复制消息");
  assert.ok(copies.length >= 1, "the same question offers a copy icon the reader can press");
  for (const control of [...pencils, ...copies]) {
    assertIconOnly(control, nameOf(control));
  }
  assert.deepEqual(
    shownEnglishNames(view, language),
    [],
    "no control the reader can see keeps an English tooltip in the Chinese interface",
  );
});

test("when the interface is in Chinese and the reader points at an answer, its footer offers only a copy icon named 复制消息 and a branch icon named 从这里分支", async (t) => {
  const { view, language } = await mountConversation(t, twoAnsweredTurns(), { language: CHINESE });
  await hover(onScreen(view, language, OPENING));
  const answerActions = answerActionsOf(view, language);
  const englishCopies = answerActions.filter((node) => nameOf(node) === "Copy message");
  assert.equal(englishCopies.length, 0, "no answer keeps the English Copy message tooltip in the Chinese interface");
  const copies = answerActions.filter((node) => nameOf(node) === "复制消息");
  assert.equal(copies.length, 2, "each of the two answers keeps its own copy icon that speaks Chinese");
  for (const control of copies) {
    assertIconOnly(control, "复制消息");
  }
  const branches = answerActions.filter((node) => nameOf(node) === "从这里分支");
  assert.equal(branches.length, 2, "each of the two answers carries exactly one branch icon");
  for (const control of branches) {
    assertIconOnly(control, "从这里分支");
  }
  assert.deepEqual(
    answerActions.filter(isShown).map((node) => nameOf(node)),
    ["复制消息", "从这里分支"],
    "the answer the reader points at offers a copy icon and a branch icon and nothing else",
  );
  assert.deepEqual(
    shownEnglishNames(view, language),
    [],
    "no control the reader can see keeps an English tooltip in the Chinese interface",
  );
  const worded = buttonsOf(view, language).filter((node) => node.textContent.includes("New session"));
  assert.equal(worded.length, 0, "no control in the message area spells out New session");
});

test("when the interface is in English, the pencil is named Edit and the branch icon is named Branch from here, both without visible text", async (t) => {
  const { view, language } = await mountConversation(t, twoAnsweredTurns(), { language: ENGLISH });
  await hover(onScreen(view, language, FOLLOW_UP_QUESTION));
  const pencils = shownButtonsNamed(view, language, "Edit");
  assert.equal(pencils.length, 1, "the question the reader points at offers the one revealed pencil");
  assertIconOnly(pencils[0], "Edit");
  const branches = buttonsNamed(view, language, "Branch from here");
  assert.equal(branches.length, 2, "each of the two answers carries exactly one branch icon");
  for (const control of branches) {
    assertIconOnly(control, "Branch from here");
  }
  const copies = buttonsNamed(view, language, "Copy message");
  assert.ok(copies.length > 0, "the messages offer a copy icon");
  for (const control of copies) {
    assertIconOnly(control, "Copy message");
  }
});

test("when the interface is in Chinese and the reader clicks 从这里分支, the button turns into a disabled, wordless 正在创建新会话… until the new session exists", async (t) => {
  const answer = createDeferred();
  const { view, language } = await mountConversation(t, twoAnsweredTurns(), {
    language: CHINESE,
    answerFork: () => answer.promise,
  });
  await hover(onScreen(view, language, OPENING));
  const [control] = buttonsNamed(view, language, "从这里分支");
  assert.ok(control, "the first answer offers a branch icon the reader can press");
  await click(control);
  await settle();
  assert.equal(nameOf(control), "正在创建新会话…", "the branch icon says a new session is being created");
  assert.equal(control.disabled, true, "the branch icon ignores further clicks while the request runs");
  assertIconOnly(control, "正在创建新会话…");
  answer.resolve({ cancelled: false, newSessionId: "forked-session" });
  await settle();
  assert.equal(nameOf(control), "从这里分支", "the branch icon returns to its usual name once the request is answered");
  assert.equal(control.disabled, false, "the branch icon can be used again");
});
