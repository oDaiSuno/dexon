import assert from "node:assert/strict";
import test, { after } from "node:test";
import { button, byRole, click, dom, loadRenderer, mount, restoreGlobals, text } from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";

const { TopBar, resetRpc, setAppLanguage } = await loadRenderer(
  "session-usage-card",
  'export {TopBar} from "./src/renderer/components/app-shell/top-bar.tsx";',
);
after(restoreGlobals);

const SESSION = {
  id: "s1",
  path: "/Users/demo/.pi/sessions/dexon/s1.jsonl",
  cwd: "/Users/demo/dexon",
  created: "2026-10-22T11:00:00.000Z",
  modified: "2026-10-22T11:58:00.000Z",
  messageCount: 47,
  firstMessage: "新会话",
  name: "新会话",
};

const STATS = {
  sessionFile: SESSION.path,
  sessionId: "s1",
  sessionName: "新会话",
  userMessages: 12,
  assistantMessages: 35,
  toolCalls: 128,
  toolResults: 128,
  totalMessages: 47,
  tokens: { input: 312_400, output: 18_200, cacheRead: 1_210_000, cacheWrite: 42_000, total: 1_582_600 },
  cost: 1.84,
};

const TOKEN_KINDS = ["输入", "输出", "缓存读取", "缓存写入"];

function cardProps(overrides = {}) {
  return {
    sidebarOpen: true,
    onToggleSidebar: () => {},
    showSidebarToggle: false,
    isMobile: false,
    selectedSession: SESSION,
    projectName: "dexon",
    activeTopPanel: "session",
    onToggleTopPanel: () => {},
    sessionStats: STATS,
    contextUsage: { percent: 62, contextWindow: 200_000, tokens: 124_000 },
    modelId: "claude-opus-4-5",
    copyFeedback: null,
    onCopyField: () => {},
    showChat: true,
    ...overrides,
  };
}

async function openCard(t, { language = "zh-CN", ...overrides } = {}) {
  dom.window.piBridge = {};
  setAppLanguage(language);
  t.after(() => setAppLanguage("en-US"));
  const boundary = installApiHostBridge(
    dom.window,
    () => ({ call: async () => ({ accounts: [], statuses: [], pairings: [], bindings: [], activities: [] }) }),
    resetRpc,
  );
  t.after(() => boundary.close());
  const view = await mount(t, TopBar, cardProps(overrides));
  const name = language === "zh-CN" ? "上下文与费用" : "Context and cost";
  const card = byRole(view.container, "region", name);
  assert.ok(card, `the open usage card is a region named ${name}`);
  return card;
}

function rowWith(card, label, figure) {
  for (let element = text(card, label); element && element !== card; element = element.parentElement) {
    if (element.textContent.includes(figure)) return element;
  }
  return null;
}

test("when the usage card is open, its top shows the context share, the used and maximum context and the model", async (t) => {
  const card = await openCard(t);
  assert.ok(text(card, "上下文"), "the section is titled 上下文");
  assert.ok(text(card, "62%"), "the share of the context window in use reads 62%");
  assert.ok(text(card, "124.0k / 200k"), "the used and maximum context read 124.0k / 200k");
  assert.ok(text(card, "claude-opus-4-5"), "the current model id is shown");
  assert.ok(!card.textContent.includes("62.0%"), "the share has no decimal place");
  assert.ok(!card.textContent.includes("20万"), "the maximum is not written as a Chinese compact number");
});

test("when the usage card is open, the cost part shows the session cost, the size of each kind of token and the estimate note", async (t) => {
  const card = await openCard(t);
  assert.ok(text(card, "本会话费用"), "the cost part is titled 本会话费用");
  assert.ok(text(card, "$1.84"), "the session cost has two decimal places");
  assert.ok(!card.textContent.includes("$1.8400"), "the cost is not written with four decimal places");
  const figures = { 输入: "312.4k", 输出: "18.2k", 缓存读取: "1.21M", 缓存写入: "42.0k" };
  for (const [kind, figure] of Object.entries(figures)) {
    const row = rowWith(card, kind, figure);
    assert.ok(row, `${kind} is shown next to ${figure}`);
    for (const other of TOKEN_KINDS.filter((name) => name !== kind))
      assert.ok(!row.textContent.includes(other), `${figure} belongs to ${kind} only, not ${other}`);
  }
  assert.ok(!card.textContent.includes("312,400"), "token sizes are not written out in full");
  assert.ok(text(card, "按服务商公开价格估算，实际以账单为准。"), "the note says the cost is an estimate");
});

test("when the usage card's details are opened, they sum up the messages and tool calls", async (t) => {
  const card = await openCard(t);
  await click(button(card, "详细信息"));
  assert.ok(text(card, "47 条消息 · 128 次工具调用"), "the summary reads 47 条消息 · 128 次工具调用");
});

test("when the context share is not known yet, the card says when it will appear and still shows the maximum context", async (t) => {
  const card = await openCard(t, {
    language: "en-US",
    contextUsage: { percent: null, contextWindow: 200_000, tokens: null },
  });
  assert.ok(text(card, "? / 200k"), "the maximum context is shown with an unknown used size");
  assert.ok(
    text(card, "Context usage updates after the next model response (e.g. right after compaction)"),
    "the card explains when the share will be known",
  );
});

test("when the usage card is open in English, the cost part and the details are written in English", async (t) => {
  const card = await openCard(t, { language: "en-US" });
  await click(button(card, "Details"));
  assert.ok(text(card, "Session cost"), "the cost part is titled Session cost");
  assert.ok(text(card, "47 messages · 128 tool calls"), "the bottom line reads 47 messages · 128 tool calls");
});
