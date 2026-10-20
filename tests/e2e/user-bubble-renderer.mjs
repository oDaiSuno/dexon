import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatWindow } from "../../src/renderer/components/ChatWindow.tsx";
import { SessionBreadcrumb } from "../../src/renderer/components/app-shell/session-breadcrumb.tsx";
import { publishSessionCatalog, clearSessionCatalog } from "../../src/renderer/lib/session-catalog.ts";
import { subscribeOpenSessionRequests } from "../../src/renderer/lib/session-open-request.ts";
import { applyChatAppearance } from "../../src/renderer/lib/chat-appearance.ts";
import { ThinkingExpansionStore } from "../../src/renderer/lib/thinking-expansion-store.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installRendererApi } from "../support/renderer-api.mjs";
import { accessibleName, allByRole, byRole, text } from "../support/dom-queries.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
setAppLanguage("en-US");

const CWD = "/workspace/project";
const SENTENCE = "看一下 @/tmp/shot.png 和 @src/main.ts 的关系";
const COMMAND = "运行下面的命令：\n\n```bash\ncat @src/a.ts | wc -l\n```\n\n然后告诉我结果";
const QUOTED = '比较 @/tmp/shot.png 和 @src/main.ts 和 @"/x/my dir/report.md" 三者';
const SPECIAL = "打开 @pkg/__init__.py 和 @~/a.ts 或 @~/b.ts";
const SKILLED = "/skill:fast-context 看 @src/main.ts";
const FROM_SESSION = "请把迁移清单做完";
const FROM_SESSION_REPLY = "迁移清单已完成";
const DELEGATED = "请在另一个会话里开始迁移";
const DELEGATED_REPLY = "已交给另一个会话";

const SENTENCES = [SENTENCE, COMMAND, QUOTED, SPECIAL, SKILLED];

const transcript = [
  ...SENTENCES.flatMap((content, index) => [
    { role: "user", content, timestamp: index * 2 + 1 },
    {
      role: "assistant",
      content: [{ type: "text", text: `第 ${index + 1} 条回复` }],
      provider: "fixture",
      model: "fixture-model",
      stopReason: "stop",
      timestamp: index * 2 + 2,
    },
  ]),
  {
    role: "user",
    content: FROM_SESSION,
    sessionSource: { sessionId: "bubble-source", title: "委派会话" },
    timestamp: 11,
  },
  {
    role: "assistant",
    content: [{ type: "text", text: FROM_SESSION_REPLY }],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "stop",
    timestamp: 12,
  },
  { role: "user", content: DELEGATED, timestamp: 13 },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        toolCallId: "session-new-1",
        toolName: "session_new",
        input: { message: "Start the migration" },
      },
    ],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "toolUse",
    timestamp: 14,
  },
  {
    role: "toolResult",
    toolCallId: "session-new-1",
    toolName: "session_new",
    content: [{ type: "text", text: "Started the migration in another session" }],
    details: { targetSessionId: "bubble-target", targetTitle: "迁移会话" },
    isError: false,
    timestamp: 15,
  },
  {
    role: "assistant",
    content: [{ type: "text", text: DELEGATED_REPLY }],
    provider: "fixture",
    model: "fixture-model",
    stopReason: "stop",
    timestamp: 16,
  },
];

const detail = createSessionDetail("user-bubble", {
  cwd: CWD,
  messages: transcript,
  entryIds: transcript.map((_, index) => `entry-${index}`),
});

const revealed = [];
const sessionHost = createSessionTestHost({
  getSession: async () => detail,
  agentState: async () => ({ running: false }),
});
const host = {
  ...sessionHost,
  call(method) {
    if (method === "files.index") return { files: [], truncated: false };
    if (method === "skills.list") return { skills: [] };
    if (method === "files.read") return null;
    if (method === "agent.generateTitle") return { title: null };
    throw new Error(`Unexpected Host request: ${method}`);
  },
};

const boundary = installRendererApi(window, { installApiShims, resetRpc }, () => host, {
  bridge: {
    showItemInFolder: async (filePath) => void revealed.push(filePath),
    inspectLocalFiles: async ({ paths }) =>
      paths.map((path) => ({ path, exists: true, isFile: true, insideCwd: true })),
  },
});

const openRequests = [];
subscribeOpenSessionRequests((sessionId) => openRequests.push(sessionId));

const sessionCwd = "/workspace/project";
const catalog = [
  {
    id: "bulb-root",
    name: "重构登录模块",
    cwd: sessionCwd,
    created: "",
    modified: "",
    firstMessage: "",
    messageCount: 1,
  },
  {
    id: "bulb-mid",
    name: "迁移旧接口",
    cwd: sessionCwd,
    created: "",
    modified: "",
    firstMessage: "",
    messageCount: 1,
    parentSessionId: "bulb-root",
  },
  {
    id: "bulb-leaf",
    name: "补接口测试",
    cwd: sessionCwd,
    created: "",
    modified: "",
    firstMessage: "",
    messageCount: 1,
    parentSessionId: "bulb-mid",
  },
  {
    id: "bubble-source",
    name: "委派会话",
    cwd: sessionCwd,
    created: "",
    modified: "",
    firstMessage: "",
    messageCount: 1,
  },
];
const leafSession = catalog[2];

const root = createRoot(document.getElementById("root"));
const thinkingExpansionStore = new ThinkingExpansionStore();
const processDetailsExpansionStore = new ThinkingExpansionStore();
let epoch = 0;

function render(theme) {
  applyChatAppearance(document.documentElement, { fontSize: "standard", layout: "fixed" });
  window.localStorage.setItem("pi-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  document.getElementById("root").style.height = "100vh";
  flushSync(() =>
    root.render(
      createElement(
        "div",
        { style: { display: "flex", flexDirection: "column", height: "100%" } },
        createElement(
          "div",
          { style: { flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" } },
          createElement(SessionBreadcrumb, { session: leafSession }),
        ),
        createElement(
          "div",
          { style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
          createElement(ChatWindow, {
            key: ++epoch,
            session: detail.info,
            newSessionCwd: null,
            thinkingExpansionStore,
            processDetailsExpansionStore,
            onSessionCreated() {},
            onAgentEnd() {},
            onOpenFile() {},
          }),
        ),
      ),
    ),
  );
}

function bounds(target) {
  const rect = typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : target;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    bottom: rect.bottom,
    right: rect.right,
    left: rect.left,
  };
}

function looksLikePath(value) {
  return value.startsWith("/") || value.startsWith("~") || value.includes("/") || /\.[A-Za-z0-9]{1,12}$/.test(value);
}

function chipsIn(scope) {
  return [...scope.querySelectorAll("[title]")]
    .filter((element) => ![...element.children].some((child) => child.hasAttribute("title")))
    .filter((element) => looksLikePath(element.getAttribute("title")));
}

function describe(element) {
  if (!element) return null;
  return {
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute("role") ?? "",
    title: element.getAttribute("title"),
    label: element.textContent.trim(),
    rect: bounds(element),
  };
}

function textRect(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  return bounds(range.getBoundingClientRect());
}

function paragraphSummary(element) {
  const chips = chipsIn(element);
  const known = new Set(chips);
  const nodes = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (known.has(child)) continue;
      if (child.nodeType === 3) {
        if (child.data.trim()) nodes.push(child);
      } else if (child.nodeType === 1) {
        walk(child);
      }
    }
  };
  walk(element);
  const style = window.getComputedStyle(element);
  return {
    text: element.textContent.replace(/\s+/g, " ").trim(),
    rect: bounds(element),
    lines: element.getClientRects().length,
    lineHeight: parseFloat(style.lineHeight),
    fontSize: parseFloat(style.fontSize),
    textRects: nodes.map(textRect),
    chips: chips.map(describe),
  };
}

function bubbleOf(marker) {
  return (
    [...document.querySelectorAll("[data-message-source]")].find((element) => element.textContent.includes(marker)) ??
    null
  );
}

function layout(marker, skillName) {
  const scope = bubbleOf(marker);
  if (!scope) return { exists: false };
  return {
    exists: true,
    rect: bounds(scope),
    fontSize: parseFloat(window.getComputedStyle(scope).fontSize),
    paragraphs: [...scope.querySelectorAll("p")].map(paragraphSummary),
    codeBlocks: [...scope.querySelectorAll("pre code")].map((element) => ({
      text: element.textContent.replace(/^\d+/, ""),
      rect: bounds(element),
    })),
    chips: chipsIn(scope).map(describe),
    skill: skillName ? describe(text(scope, skillName)) : null,
  };
}

function editor() {
  const composer = byRole(document, "group", "Message input");
  return composer ? byRole(composer, "textbox") : null;
}

function composerChip() {
  const element = editor();
  if (!element) return null;
  const chips = allByRole(element, "button").filter((candidate) => !candidate.parentElement.closest('[role="button"]'));
  return chips.find((candidate) => candidate.getAttribute("title") === "/tmp/shot.png") ?? chips[0] ?? null;
}

function styleSummary(element) {
  if (!element) return null;
  const style = window.getComputedStyle(element);
  const parent = element.parentElement;
  const surroundingFontSize = parseFloat(window.getComputedStyle(parent ?? element).fontSize);
  const glyph = element.querySelector("svg, img");
  return {
    tag: element.tagName.toLowerCase(),
    title: element.getAttribute("title"),
    label: element.textContent.trim(),
    rect: bounds(element),
    borderRadius: style.borderTopLeftRadius,
    borderWidth: style.borderTopWidth,
    borderStyle: style.borderTopStyle,
    backgroundColor: style.backgroundColor,
    color: style.color,
    paddingLeft: parseFloat(style.paddingLeft),
    paddingRight: parseFloat(style.paddingRight),
    glyph: glyph ? bounds(glyph) : null,
    fontSize: parseFloat(style.fontSize),
    surroundingFontSize,
  };
}

window.userBubble = {
  configure({ theme = "light" } = {}) {
    render(theme);
  },
  layout,
  scrollTo(marker) {
    bubbleOf(marker)?.scrollIntoView({ block: "center" });
  },
  chipCenter(marker, title) {
    const scope = bubbleOf(marker);
    const chip = scope ? chipsIn(scope).find((element) => element.getAttribute("title") === title) : null;
    if (!chip) return null;
    const rect = chip.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  bubbleChipStyle(marker, title) {
    const scope = bubbleOf(marker);
    if (!scope) return null;
    return styleSummary(chipsIn(scope).find((element) => element.getAttribute("title") === title) ?? null);
  },
  composerChipStyle() {
    return styleSummary(composerChip());
  },
  focusComposer() {
    editor()?.focus();
  },
  blurActive() {
    document.activeElement?.blur?.();
  },
  focusedChipTitle() {
    const active = document.activeElement;
    return active && active.hasAttribute?.("title") ? active.getAttribute("title") : null;
  },
  revealed() {
    return [...revealed];
  },
  breadcrumb() {
    const nav = byRole(document, "navigation", "Session path");
    if (!nav) return { exists: false };
    return {
      exists: true,
      text: nav.textContent.replace(/\s+/g, " ").trim(),
      rect: bounds(nav),
      segments: [...nav.querySelectorAll("button, [aria-current]")].map((element) => ({
        label: accessibleName(element),
        current: element.getAttribute("aria-current"),
        tag: element.tagName.toLowerCase(),
        rect: bounds(element),
      })),
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  },
  breadcrumbCenter(label) {
    const nav = byRole(document, "navigation", "Session path");
    const segment = nav ? allByRole(nav, "button", label)[0] : null;
    if (!segment) return null;
    const rect = segment.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  },
  publishCatalog(ids) {
    const keep = new Set(ids);
    publishSessionCatalog(catalog.filter((item) => keep.has(item.id)));
  },
  clearCatalog() {
    clearSessionCatalog();
  },
  openRequests() {
    return [...openRequests];
  },
  sessionLinkCenter(label) {
    const button = allByRole(document, "button", label)[0];
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      hits: button.contains(hit),
      hit: hit ? `${hit.tagName}.${hit.className}` : null,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    };
  },
  scrollSessionLinkIntoView(label) {
    allByRole(document, "button", label)[0]?.scrollIntoView({ block: "center" });
  },
  sessionLink(label) {
    const button = allByRole(document, "button", label)[0];
    return button ? { label: accessibleName(button), text: button.textContent.trim(), rect: bounds(button) } : null;
  },
  sourceChipLayout(marker) {
    const scope = bubbleOf(marker);
    if (!scope) return { exists: false };
    const chip =
      allByRole(scope, "button").find((element) => accessibleName(element).startsWith("From session")) ?? null;
    return {
      exists: true,
      bubble: bounds(scope),
      paragraphs: [...scope.querySelectorAll("p")].map(paragraphSummary),
      chip: chip
        ? { label: accessibleName(chip), rect: bounds(chip), text: chip.textContent.replace(/\s+/g, " ").trim() }
        : null,
      lines: [...scope.querySelectorAll("p")].reduce((total, element) => total + element.getClientRects().length, 0),
    };
  },
  page() {
    return {
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      pageBackground: window.getComputedStyle(document.body).backgroundColor,
    };
  },
  close() {
    try {
      flushSync(() => root.unmount());
    } finally {
      boundary.close();
    }
  },
};

publishSessionCatalog(catalog);
render("light");
