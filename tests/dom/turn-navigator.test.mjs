import assert from "node:assert/strict";
import test, { after } from "node:test";
import { allByRole } from "../support/dom-queries.mjs";
import {
  act,
  accessibleName,
  byRole,
  click,
  dom,
  keyDown,
  loadRenderer,
  mount,
  restoreGlobals,
} from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  createSessionDetail,
  createSessionTestHost,
} from "../../src/renderer/hooks/agent-session/session-hook-harness.mjs";

const { ChatWindow, ThinkingExpansionStore, resetRpc, setAppLanguage } = await loadRenderer(
  "turn-navigator",
  'export {ChatWindow} from "./src/renderer/components/ChatWindow.tsx"; export {ThinkingExpansionStore} from "./src/renderer/lib/thinking-expansion-store.ts";',
);
after(() => {
  setAppLanguage("en-US");
  restoreGlobals();
});

const VIEW_HEIGHT = 600;
const FIRST = "Read DESIGN.md and list";
const SECOND = "Check the diff";
const THIRD = "Show relative times in the session list";

const reply = (text, timestamp) => ({
  role: "assistant",
  provider: "fixture",
  model: "fixture-model",
  content: [{ type: "text", text }],
  stopReason: "stop",
  timestamp,
});

const threeTurns = () => [
  { role: "user", content: `${FIRST}\nthe color tokens`, timestamp: 1 },
  reply("Listed the tokens.", 2),
  {
    role: "user",
    content: `<skill name="review" location="/skills/review/SKILL.md">\nReview carefully.\n</skill>\n\n${SECOND}`,
    timestamp: 3,
  },
  reply("Checked it.", 4),
  { role: "user", content: [{ type: "text", text: THIRD }], timestamp: 5 },
  reply("Done.", 6),
];

async function settle() {
  for (let pass = 0; pass < 3; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function mountConversation(t, messages) {
  const detail = createSessionDetail("turns", {
    messages,
    entryIds: messages.map((_, index) => `turns-${index}`),
    messageCount: messages.length,
  });
  const host = createSessionTestHost({ getSession: async () => detail });
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
    thinkingExpansionStore: new ThinkingExpansionStore(),
    processDetailsExpansionStore: new ThinkingExpansionStore(),
  });
  await settle();
  const container = byRole(view.container, "region", /^(Conversation|对话内容)$/);
  assert.ok(container, "the loaded conversation has its scroll area");
  return { view, container };
}

function layOut(t, container, { contentHeight, questionTops }) {
  Object.defineProperty(container, "clientHeight", { configurable: true, get: () => VIEW_HEIGHT });
  Object.defineProperty(container, "scrollHeight", { configurable: true, get: () => contentHeight });
  const prototype = dom.window.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, "getBoundingClientRect");
  const box = (top) => ({ top, bottom: top + 80, height: 80, left: 0, right: 600, width: 600, x: 0, y: top });
  prototype.getBoundingClientRect = function () {
    if (this === container) return box(0);
    const hits = questionTops.filter(([marker]) => this.textContent.includes(marker));
    return hits.length === 1 ? box(hits[0][1] - container.scrollTop) : box(0);
  };
  t.after(() => {
    if (original) Object.defineProperty(prototype, "getBoundingClientRect", original);
    else delete prototype.getBoundingClientRect;
  });
}

async function scrollTo(container, top) {
  await act(async () => {
    container.scrollTop = top;
    container.dispatchEvent(new dom.window.Event("scroll"));
  });
}

const navigatorOf = (view, name = "Conversation navigator") => byRole(view.container, "navigation", name);
const turnsOf = (view, name) => {
  const navigator = navigatorOf(view, name);
  assert.ok(navigator, "the long conversation shows its turn navigator");
  return allByRole(navigator, "button");
};
const currentTurns = (view) =>
  turnsOf(view)
    .filter((turn) => turn.getAttribute("aria-current") === "true")
    .map(accessibleName);

const NAMES = [
  "Turn 1: Read DESIGN.md and list the color tokens",
  "Turn 2: /skill:review Check the diff",
  "Turn 3: Show relative times in the session list",
];
const TOPS = [
  [FIRST, 0],
  [SECOND, 1000],
  [THIRD, 2000],
];

async function longConversation(t, questionTops = TOPS) {
  const scene = await mountConversation(t, threeTurns());
  layOut(t, scene.container, { contentHeight: 3000, questionTops });
  await scrollTo(scene.container, 0);
  return scene;
}

test("when a conversation is longer than the view, a navigator lists only the user turns, each named by its question", async (t) => {
  setAppLanguage("en-US");
  const { view } = await longConversation(t);
  assert.ok(navigatorOf(view), "the conversation offers a navigator");
  assert.deepEqual(turnsOf(view).map(accessibleName), NAMES);
});

test("while the reader scrolls, the current turn is the last one whose question has reached the upper third of the view", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await longConversation(t);
  assert.deepEqual(currentTurns(view), [NAMES[0]]);
  await scrollTo(container, 700);
  assert.deepEqual(currentTurns(view), [NAMES[0]], "turn 2 at 1000px is still below the line at 900px");
  await scrollTo(container, 900);
  assert.deepEqual(currentTurns(view), [NAMES[1]], "turn 2 at 1000px has passed the line at 1100px");
  await scrollTo(container, 2000);
  assert.deepEqual(currentTurns(view), [NAMES[2]]);
});

test("at the very bottom of the conversation the last turn is current even when its question is low in the view", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await longConversation(t, [
    [FIRST, 0],
    [SECOND, 1000],
    [THIRD, 2700],
  ]);
  await scrollTo(container, 2300);
  assert.deepEqual(currentTurns(view), [NAMES[1]], "100px above the bottom the second turn is still current");
  await scrollTo(container, 2400);
  assert.deepEqual(currentTurns(view), [NAMES[2]]);
});

test("choosing a turn scrolls the conversation so its question sits 16px below the top", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await longConversation(t);
  await click(turnsOf(view)[2]);
  assert.equal(container.scrollTop, 1984);
  await click(turnsOf(view)[1]);
  assert.equal(container.scrollTop, 984);
  await click(turnsOf(view)[0]);
  assert.equal(container.scrollTop, 0, "the first question cannot be pulled above the start");
});

test("from the keyboard only the current turn is a tab stop, and arrows, Home and End move between turns", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await longConversation(t);
  await scrollTo(container, 900);
  const [first, second, third] = turnsOf(view);
  assert.deepEqual(
    [first, second, third].map((turn) => turn.tabIndex),
    [-1, 0, -1],
  );
  await keyDown(second, "ArrowDown");
  assert.equal(dom.window.document.activeElement, third);
  await keyDown(third, "ArrowDown");
  assert.equal(dom.window.document.activeElement, third, "the last turn keeps focus at the end");
  await keyDown(third, "Home");
  assert.equal(dom.window.document.activeElement, first);
  await keyDown(first, "ArrowUp");
  assert.equal(dom.window.document.activeElement, first, "the first turn keeps focus at the start");
  await keyDown(first, "End");
  assert.equal(dom.window.document.activeElement, third);
  await keyDown(third, "ArrowUp");
  assert.equal(dom.window.document.activeElement, second);
  assert.equal(container.scrollTop, 900, "moving focus alone does not scroll the conversation");
});

test("a conversation that fits in the view shows no navigator", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await mountConversation(t, threeTurns());
  layOut(t, container, { contentHeight: 620, questionTops: TOPS });
  await scrollTo(container, 0);
  assert.equal(navigatorOf(view), undefined, "20px of overflow is not worth navigating");
});

test("a question without any text is named by its turn number alone", async (t) => {
  setAppLanguage("en-US");
  const { view, container } = await mountConversation(t, [
    { role: "user", content: "Compare these screenshots", timestamp: 1 },
    reply("They differ.", 2),
    { role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], timestamp: 3 },
    reply("Seen.", 4),
  ]);
  layOut(t, container, { contentHeight: 3000, questionTops: [] });
  await scrollTo(container, 0);
  assert.deepEqual(turnsOf(view).map(accessibleName), ["Turn 1: Compare these screenshots", "Turn 2"]);
});

test("in Chinese the navigator, its turns and the bottom button use the design wording", async (t) => {
  setAppLanguage("zh-CN");
  const { view, container } = await mountConversation(t, [
    { role: "user", content: "先通读 DESIGN.md，列出现有的颜色令牌", timestamp: 1 },
    reply("好的。", 2),
    { role: "user", content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], timestamp: 3 },
    reply("看到了。", 4),
  ]);
  layOut(t, container, { contentHeight: 3000, questionTops: [] });
  await scrollTo(container, 0);
  assert.deepEqual(turnsOf(view, "对话缩略导航").map(accessibleName), [
    "第 1 轮：先通读 DESIGN.md，列出现有的颜色令牌",
    "第 2 轮",
  ]);
  assert.ok(byRole(view.container, "button", "滚到底部"), "the return button is named 滚到底部");
});
