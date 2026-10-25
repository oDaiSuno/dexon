import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  byRole,
  button,
  click,
  dom,
  keyDown,
  loadRenderer,
  mount,
  mouseDown,
  restoreGlobals,
  text,
} from "../support/renderer.mjs";
import { installApiHostBridge } from "../support/api-host.mjs";

const { TopBar, SessionControls, resetRpc, setAppLanguage } = await loadRenderer(
  "session-usage-breakdown",
  'export {TopBar} from "./src/renderer/components/app-shell/top-bar.tsx"; export {SessionControls} from "./src/renderer/components/chat-input/SessionControls.tsx";',
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
  costs: { input: 0.94, output: 0.46, cacheRead: 0.36, cacheWrite: 0.08 },
  lastCompactionAt: null,
};

const USAGE = {
  percent: 62,
  contextWindow: 200_000,
  tokens: 124_000,
  reserveTokens: 16_400,
  breakdown: { systemPrompt: 3_100, tools: 11_800, agentsAndSkills: 6_400, conversation: 38_200, toolResults: 64_500 },
};

function barProps(overrides = {}) {
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
    contextUsage: USAGE,
    modelId: "claude-opus-4-5",
    compaction: null,
    copyFeedback: null,
    onCopyField: () => {},
    showChat: true,
    ...overrides,
  };
}

function useBoundary(t) {
  dom.window.piBridge = {};
  setAppLanguage("zh-CN");
  t.after(() => setAppLanguage("en-US"));
  const boundary = installApiHostBridge(
    dom.window,
    () => ({ call: async () => ({ accounts: [], statuses: [], pairings: [], bindings: [], activities: [] }) }),
    resetRpc,
  );
  t.after(() => boundary.close());
}

async function openCard(t, overrides) {
  useBoundary(t);
  const view = await mount(t, TopBar, barProps(overrides));
  const card = byRole(view.container, "region", "上下文与费用");
  assert.ok(card, "the usage card is open");
  return { view, card };
}

function rowWith(card, label, ...figures) {
  for (let element = text(card, label); element && element !== card; element = element.parentElement) {
    if (figures.every((figure) => element.textContent.includes(figure))) return element;
  }
  return null;
}

test("when the usage card is open, the legend lists each part of the context with its size and share of the window", async (t) => {
  const { card } = await openCard(t);
  const legend = {
    系统提示词: ["3.1k", "1.6%"],
    工具定义: ["11.8k", "5.9%"],
    "AGENTS.md 与技能": ["6.4k", "3.2%"],
    对话消息: ["38.2k", "19.1%"],
    工具结果: ["64.5k", "32.3%"],
    可用空间: ["59.6k", "29.8%"],
    压缩预留: ["16.4k", "8.2%"],
  };
  for (const [label, figures] of Object.entries(legend)) {
    const row = rowWith(card, label, ...figures);
    assert.ok(row, `${label} is shown with ${figures.join(" and ")}`);
    for (const other of Object.keys(legend).filter((name) => name !== label))
      assert.ok(!row.textContent.includes(other), `${figures[0]} belongs to ${label} only`);
  }
});

test("when automatic compaction is off, the legend has no compaction reserve and all unused room counts as free", async (t) => {
  const withoutReserve = { ...USAGE, reserveTokens: undefined };
  const { card } = await openCard(t, { contextUsage: withoutReserve });
  assert.ok(!card.textContent.includes("压缩预留"), "no reserve row");
  assert.ok(rowWith(card, "可用空间", "76.0k", "38.0%"), "free space is the window minus what is used");
});

test("when the usage card is open, it says how much more can be used before automatic compaction and compacts on request", async (t) => {
  let compactions = 0;
  const compaction = {
    isCompacting: false,
    disabled: false,
    error: null,
    compact: () => compactions++,
    abort: () => {},
  };
  const { card } = await openCard(t, { compaction });
  assert.ok(text(card, "再用约 59.6k 后自动压缩"), "the remaining room before compaction is the free space");
  await click(button(card, "立即压缩"));
  assert.equal(compactions, 1, "立即压缩 starts one compaction");
});

test("while compacting, the card's compact button stops the compaction instead", async (t) => {
  let stops = 0;
  const compaction = { isCompacting: true, disabled: false, error: null, compact: () => {}, abort: () => stops++ };
  const { card } = await openCard(t, { compaction });
  assert.ok(!button(card, "立即压缩"), "no second compaction can be started");
  await click(button(card, "停止压缩"));
  assert.equal(stops, 1);
});

test("when compaction fails, the card shows why", async (t) => {
  const compaction = { isCompacting: false, disabled: false, error: "模型不可用", compact: () => {}, abort: () => {} };
  const { card } = await openCard(t, { compaction });
  assert.ok(text(card, "模型不可用"), "the failure reason is on screen");
});

test("when the agent is replying, the card's compact button cannot be used", async (t) => {
  const compaction = { isCompacting: false, disabled: true, error: null, compact: () => {}, abort: () => {} };
  const { card } = await openCard(t, { compaction });
  assert.equal(button(card, "立即压缩").disabled, true);
});

test("when the usage card is open, each kind of token shows what it cost", async (t) => {
  const { card } = await openCard(t);
  const rows = {
    输入: ["312.4k", "$0.94"],
    输出: ["18.2k", "$0.46"],
    缓存读取: ["1.21M", "$0.36"],
    缓存写入: ["42.0k", "$0.08"],
  };
  for (const [kind, figures] of Object.entries(rows))
    assert.ok(rowWith(card, kind, ...figures), `${kind} costs ${figures[1]}`);
});

test("when the session was compacted before, the card's bottom line says how long ago", async (t) => {
  const lastCompactionAt = new Date(Date.now() - 18 * 60_000 - 5_000).toISOString();
  const { card } = await openCard(t, { sessionStats: { ...STATS, lastCompactionAt } });
  assert.match(card.textContent, /上次压缩 18\s?分钟前/);
});

test("the session details and message counts stay folded away until the user opens 详细信息", async (t) => {
  const { card } = await openCard(t);
  const toggle = button(card, "详细信息");
  assert.ok(toggle, "a 详细信息 control is at the bottom of the card");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(!card.textContent.includes(SESSION.path), "the session file is folded away");
  assert.ok(!card.textContent.includes("47 条消息"), "the message counts are folded away");
  await click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.ok(card.textContent.includes(SESSION.path), "the session file is shown");
  assert.ok(card.textContent.includes("s1"), "the session id is shown");
  assert.ok(text(card, "47 条消息 · 128 次工具调用"), "the message counts are shown");
});

test("pressing Escape closes the usage card and puts focus back on the usage capsule", async (t) => {
  let toggles = 0;
  const { view } = await openCard(t, { onToggleTopPanel: () => toggles++ });
  const capsule = button(view.container, "查看上下文与费用");
  await keyDown(button(view.container, "详细信息"), "Escape");
  assert.equal(toggles, 1, "Escape asks to close the card");
  await view.update(barProps({ activeTopPanel: null, onToggleTopPanel: () => toggles++ }));
  assert.equal(dom.window.document.activeElement, capsule, "focus returns to the capsule");
});

test("pressing down outside the usage card closes it, pressing inside does not", async (t) => {
  let toggles = 0;
  const { card } = await openCard(t, { onToggleTopPanel: () => toggles++ });
  await mouseDown(button(card, "详细信息"));
  assert.equal(toggles, 0, "pressing inside the card keeps it open");
  const outside = dom.window.document.createElement("button");
  dom.window.document.body.appendChild(outside);
  t.after(() => outside.remove());
  await mouseDown(outside);
  assert.equal(toggles, 1, "pressing outside closes the card");
});

test("a closed usage card does not react to Escape", async (t) => {
  let toggles = 0;
  useBoundary(t);
  const view = await mount(t, TopBar, barProps({ activeTopPanel: null, onToggleTopPanel: () => toggles++ }));
  await keyDown(button(view.container, "查看上下文与费用"), "Escape");
  assert.equal(toggles, 0);
});

function controlsProps(overrides = {}) {
  return {
    visible: true,
    isMobile: false,
    isStreaming: false,
    closeDropdowns: () => {},
    thinkingLevel: "off",
    thinkingDropdownOpen: false,
    onThinkingToggle: () => {},
    thinkingContainerRef: { current: null },
    thinkingButtonRef: { current: null },
    contextUsage: { percent: 62, contextWindow: 200_000, tokens: 124_000 },
    onOpenUsage: () => {},
    onCompact: () => {},
    isCompacting: false,
    ...overrides,
  };
}

test("below the composer there is no compact button, and nothing about context while it is at most 80% full", async (t) => {
  useBoundary(t);
  for (const percent of [62, 80]) {
    const view = await mount(
      t,
      SessionControls,
      controlsProps({ contextUsage: { percent, contextWindow: 200_000, tokens: percent * 2_000 } }),
    );
    assert.ok(!view.container.textContent.includes("压缩"), `no compact control at ${percent}%`);
    assert.ok(!view.container.textContent.includes(`${percent}%`), `no context hint at ${percent}%`);
    await view.unmount();
  }
});

test("when the context is more than 80% full, a small hint below the composer opens the usage card", async (t) => {
  useBoundary(t);
  let opened = 0;
  const view = await mount(
    t,
    SessionControls,
    controlsProps({
      contextUsage: { percent: 85, contextWindow: 200_000, tokens: 170_000 },
      onOpenUsage: () => opened++,
    }),
  );
  await click(button(view.container, "上下文 85%"));
  assert.equal(opened, 1);
});
