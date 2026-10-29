import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { NavSidebar } from "../../src/renderer/components/app-nav/nav-sidebar.tsx";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { call, resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { installApiHostBridge } from "../support/api-host.mjs";
import {
  navigationSessions,
  sessionTreeFoldedIds,
  sessionTreeRunningIds,
  sessionTreeSessions,
  sessionTreeStatuses,
} from "../fixtures/nav-sidebar.mjs";
import { accessibleName, allByRole, byRole, getByRole, text } from "../support/dom-queries.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
const sessionLists = {
  default: navigationSessions,
  tree: sessionTreeSessions(),
};
let sessions = sessionLists.default.map((item) => ({ ...item }));
const requests = [];
const actions = [];
// Only the other process's answers are fixtures. The real client, API fetch
// compatibility layer, RPC framing and server dispatch are not replaced.
const boundary = installApiHostBridge(
  window,
  () => ({
    call(method, params) {
      requests.push({ method, params });
      if (method === "sessions.list") return { sessions, runningSessionIds: [] };
      if (method === "sessions.rename") {
        sessions = sessions.map((item) => (item.id === params.id ? { ...item, name: params.name } : item));
        return { ok: true };
      }
      throw new Error(`Unexpected native navigation request ${method}`);
    },
  }),
  resetRpc,
);
installApiShims();
const root = createRoot(document.getElementById("root"));
let epoch = 0;
let currentSpaceName = "Personal space";

function boxOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
}

function navigation() {
  return getByRole(document, "navigation", document.documentElement.lang === "zh-CN" ? "主导航" : "Main navigation");
}

function NavigationScene({
  expanded: initialExpanded,
  spaceName,
  initialSessions,
  foldedSessionIds,
  liveStatuses,
  runningSessionIds,
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [page, setPage] = useState("chat");
  const [currentSessions, setSessions] = useState(initialSessions);
  const [folded, setFolded] = useState(() => new Set(foldedSessionIds));
  const refresh = async () => setSessions((await call("sessions.list")).sessions);
  const toggleFold = (sessionId) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(sessionId)) next.add(sessionId);
      return next;
    });
  return createElement(
    "div",
    { style: { display: "flex", height: "100%", minWidth: 0, overflow: "hidden" } },
    createElement(NavSidebar, {
      expanded,
      page,
      spaceName,
      spacePath: "/Users/tester/.dexon",
      sessions: currentSessions,
      loading: false,
      error: null,
      selectedSessionId: null,
      liveStatuses,
      runningSessionIds: new Set(runningSessionIds),
      unreadSessionIds: new Set(),
      foldedSessionIds: folded,
      onToggleFold: toggleFold,
      homeDir: "/Users/tester",
      onToggleExpanded: () => setExpanded((value) => !value),
      onNavigate: setPage,
      onSelectSession: (item) => actions.push(`selected:${item.id}`),
      onNewSession: () => actions.push("new session"),
      onRefreshSessions: () => {
        void refresh();
      },
      onOpenSettings: () => actions.push("settings"),
      onChooseFolder: () => actions.push("choose folder"),
      onBackToPersonalSpace: () => actions.push("personal space"),
    }),
    createElement(
      "main",
      { style: { flex: 1, minWidth: 0, padding: 24 } },
      createElement("h1", null, page === "chat" ? "Conversation" : "Plugins & Skills"),
      createElement("p", null, "This scene loads the real navigation, production CSS and offline fonts."),
    ),
  );
}

window.navLayout = {
  find: (role, name) => byRole(navigation(), role, name),
  main: () => getByRole(document, "main"),
  nameOf: accessibleName,
  elements() {
    const chinese = document.documentElement.lang === "zh-CN";
    const nav = navigation();
    const workspace = byRole(nav, "group", chinese ? "工作区控制区" : "Workspace controls");
    const row = workspace ? getByRole(workspace, "button", currentSpaceName) : null;
    const actionsName = chinese ? `${currentSpaceName} 的项目操作` : `Actions for ${currentSpaceName}`;
    const trigger = workspace ? getByRole(workspace, "button", actionsName) : null;
    const label = row ? text(row, currentSpaceName) : null;
    return {
      nav,
      workspace,
      trigger,
      label,
      toggle:
        byRole(nav, "button", chinese ? "隐藏侧边栏" : "Hide sidebar") ??
        getByRole(nav, "button", chinese ? "显示侧边栏" : "Show sidebar"),
      controls: allByRole(nav, "button").map((element) => ({ element, label: accessibleName(element) })),
    };
  },
  async configure({
    expanded = true,
    spaceName = "Personal space",
    theme = "light",
    language = "en-US",
    scene = "default",
    unfolded = false,
  } = {}) {
    currentSpaceName = spaceName;
    sessions = sessionLists[scene].map((item) => ({ ...item }));
    setAppLanguage(language);
    document.documentElement.classList.toggle("dark", theme === "dark");
    const listed = await call("sessions.list");
    const treeScene = scene === "tree";
    flushSync(() =>
      root.render(
        createElement(NavigationScene, {
          key: ++epoch,
          expanded,
          spaceName,
          initialSessions: listed.sessions,
          foldedSessionIds: treeScene && !unfolded ? sessionTreeFoldedIds : [],
          liveStatuses: treeScene ? sessionTreeStatuses : {},
          runningSessionIds: treeScene ? sessionTreeRunningIds : [],
        }),
      ),
    );
    await document.fonts.load('14px "Inter"');
    await document.fonts.load('14px "Geist Mono"');
    await document.fonts.ready;
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  },
  rows() {
    const nav = navigation();
    return [...nav.querySelectorAll('[role="listitem"]')].map((item) => {
      const row = item.querySelector("button");
      const title = item.querySelector("[data-session-row-title]");
      const time = item.querySelector("[data-session-row-time]");
      const counts = item.querySelector("[data-session-row-counts]");
      return {
        name: accessibleName(row),
        indent: item.getBoundingClientRect().x - nav.getBoundingClientRect().x,
        titleWidth: title ? title.clientWidth : null,
        titleScrollWidth: title ? title.scrollWidth : null,
        rowBox: boxOf(item),
        time: time ? time.textContent : null,
        counts: counts ? counts.textContent : null,
        countsBox: counts ? boxOf(counts) : null,
      };
    });
  },
  snapshot: () => ({ requests, actions }),
  close() {
    try {
      root.unmount();
    } finally {
      boundary.close();
    }
  },
};
