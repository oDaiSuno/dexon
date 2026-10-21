import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { setAppLanguage } from "../renderer/i18n.ts";
import { NavSidebar } from "../renderer/components/app-nav/nav-sidebar.tsx";
import { ResourcePage } from "../renderer/components/app-nav/resource-page.tsx";
import { MessageView } from "../renderer/components/MessageView.tsx";
import { ChatInput } from "../renderer/components/ChatInput.tsx";
// Style cascade mirrors main.tsx exactly: the production entry first (its
// Tailwind preflight reset and full Geist font declarations are part of the
// real typography), then the app partials and the chat surface. The capture
// script compiles globals.css through the real Tailwind postcss pipeline.
import "../renderer/globals.css";
import "../renderer/styles/tokens.css";
import "../renderer/styles/motion-tokens.css";
import "../renderer/styles/base.css";
import "../renderer/styles/sidebar.css";
import "../renderer/styles/composer.css";
import "../renderer/styles/markdown.css";
import "../renderer/styles/motion.css";
import "../renderer/styles/nav.css";
import "../renderer/styles/panels.css";
import "../renderer/styles/chat-scope.css";
import "../renderer/styles/chat-motion.css";
import "../renderer/styles/chat-window.css";
import "../renderer/styles/messages.css";
import "../renderer/styles/tool-cards.css";
import { buildPreviewData } from "./ui-preview-data.mjs";

// The preview runs in a real browser window (Electron); alias the globals the
// same way as the interactive-tools smoke renderer so eslint stays happy.
const document = globalThis.document;
const window = globalThis.window;
const requestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
const getComputedStyle = globalThis.getComputedStyle.bind(globalThis);

/**
 * Dev-only preview assembly for Phase 4: renders the REAL navigation, the
 * real resource page and a real chat canvas with in-memory sample data. The
 * resource page fetches run through the /api shim below; RPC imports are
 * replaced by the api-client mock at bundle time. Nothing here touches a
 * real Agent Host, session file or configuration.
 */

const data = buildPreviewData({ now: new Date() });

// ---------------------------------------------------------------------------
// /api fetch shim: the resource configs load through plain fetch in the real
// app; inside the preview those routes answer with the sample data instead.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch.bind(globalThis);
const jsonResponse = (body, status = 200) =>
  Promise.resolve(
    new globalThis.Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

const PLUGINS_RESPONSE = {
  packages: data.plugins,
  totals: data.plugins.reduce(
    (acc, pkg) => ({
      extensions: acc.extensions + pkg.counts.extensions,
      skills: acc.skills + pkg.counts.skills,
      prompts: acc.prompts + pkg.counts.prompts,
      themes: acc.themes + pkg.counts.themes,
    }),
    { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  ),
  diagnostics: [],
};

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input?.url ?? "");
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  if (path === "/api/skills" || path.startsWith("/api/skills?")) {
    if ((init?.method ?? "GET") === "PATCH") return jsonResponse({ ok: true });
    return jsonResponse({ skills: data.skills });
  }
  if (path === "/api/skills/search") return jsonResponse({ results: [] });
  if (path === "/api/skills/install") return jsonResponse({ success: true });
  if (path === "/api/plugins" || path.startsWith("/api/plugins?")) {
    return jsonResponse(PLUGINS_RESPONSE);
  }
  return originalFetch(input, init);
};

// ---------------------------------------------------------------------------
// Preview app: [NavSidebar | center canvas] driven by window.preview.
// ---------------------------------------------------------------------------

const rootElement = document.getElementById("preview-root");
const root = createRoot(rootElement);

const SCREENS = {
  "chat-expanded": { expanded: true, page: "chat" },
  "chat-rail": { expanded: false, page: "chat" },
  plugins: { expanded: true, page: "resources" },
  skills: { expanded: true, page: "resources" },
};

let currentScreen = "chat-expanded";
// Each configure remounts the sidebar so internal UI state (open menu, open
// search) never leaks between captures; applyState re-opens what a shot asks for.
let renderEpoch = 0;

function chatCanvas() {
  const messages = createElement(
    "div",
    {
      style: {
        flex: "1 1 auto",
        overflowY: "auto",
        padding: "24px 20px 8px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      },
    },
    createElement(
      "div",
      { style: { width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", gap: 10 } },
      data.chatMessages.map((message, index) =>
        createElement(MessageView, {
          key: index,
          sessionId: null,
          message,
          cwd: data.cwd,
          afterAssistant: message.role === "user" && index > 0,
          toolResults: new Map(),
        }),
      ),
    ),
  );
  const composer = createElement(
    "div",
    { style: { padding: "8px 20px 16px", flexShrink: 0, display: "flex", justifyContent: "center" } },
    createElement(
      "div",
      { style: { width: "100%", maxWidth: 760 } },
      createElement(ChatInput, {
        onSend: () => undefined,
        onAbort: () => undefined,
        isStreaming: false,
        model: { provider: "guda-responses", modelId: "gpt-6-astra" },
        modelNames: { "guda-responses:gpt-6-astra": "GPT-6 Astra" },
        modelList: [{ id: "gpt-6-astra", name: "GPT-6 Astra", provider: "guda-responses" }],
        draftKey: "preview:new",
        cwd: data.cwd,
      }),
    ),
  );
  return createElement(
    "div",
    {
      className: "chat-appearance-scope",
      style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
    },
    messages,
    composer,
  );
}

function resourceCanvas(screen) {
  return createElement(ResourcePage, {
    cwd: data.cwd,
    activeTab: screen === "plugins" ? "plugins" : "skills",
    onTabChange: () => undefined,
  });
}

function renderCurrent() {
  const layout = SCREENS[currentScreen];
  const canvas = layout.page === "resources" ? resourceCanvas(currentScreen) : chatCanvas();
  flushSync(() => {
    root.render(
      createElement(
        "div",
        { style: { display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" } },
        createElement(NavSidebar, {
          key: renderEpoch,
          expanded: layout.expanded,
          page: layout.page,
          spacePath: data.space.path,
          sessions: data.sessions,
          loading: false,
          error: null,
          selectedSessionId: data.sessions[0]?.id ?? null,
          runningSessionIds: new Set(data.runningSessionIds),
          unreadSessionIds: new Set(data.unreadSessionIds),
          homeDir: "/Users/demo",
          onToggleExpanded: () => undefined,
          onNavigate: () => undefined,
          onSelectSession: () => undefined,
          onNewSession: () => undefined,
          onRefreshSessions: () => undefined,
          onOpenSettings: () => undefined,
          onOpenFolder: () => undefined,
          onChooseFolder: () => undefined,
          onSwitchSpace: () => undefined,
          onBackToPersonalSpace: () => undefined,
          onSessionDeleted: () => undefined,
        }),
        canvas,
      ),
    );
  });
}

async function raf2() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function settleAnimations() {
  await document.fonts.ready;
  await raf2();
  const finite = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
  await Promise.race([
    Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 400)),
  ]);
  await raf2();
}

function applyState(state) {
  if (!state) return;
  if (state.search) clickRequired("[data-nav-search-toggle]", "search toggle");
  if (state.menu) clickRequired('[aria-haspopup="menu"]', "space menu trigger");
}

function clickRequired(selector, what) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`ui-preview: expected to find ${what} (${selector})`);
  element.click();
}

window.preview = {
  async configure({ screen, theme, lang, state }) {
    renderEpoch += 1;
    if (screen) currentScreen = screen;
    if (lang) setAppLanguage(lang === "en" ? "en-US" : "zh-CN");
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme ?? "light";
    renderCurrent();
    await settleAnimations();
    applyState(state);
    await settleAnimations();
    return { ok: true, screen: currentScreen };
  },
  /**
   * Reduced-motion evidence: CSS transition/animation durations inside the nav
   * scopes plus a count of SVG (SMIL) animation nodes, which CSS durations do
   * not control (review R2). A complete fallback must report zero of both.
   */
  measureMotion() {
    const values = [];
    for (const scope of [".app-nav", ".app-nav-resource"]) {
      for (const el of document.querySelectorAll(scope)) {
        for (const node of [el, ...el.querySelectorAll("*")]) {
          const style = getComputedStyle(node);
          if (style.animationName !== "none") {
            values.push({ kind: "animation", name: style.animationName, duration: style.animationDuration });
          }
          if (style.transitionProperty !== "all" && style.transitionProperty !== "none") {
            values.push({
              kind: "transition",
              property: style.transitionProperty,
              duration: style.transitionDuration,
            });
          }
        }
      }
    }
    const smilNodes = document.querySelectorAll(
      ".app-nav animate, .app-nav animateTransform, .app-nav-resource animate, .app-nav-resource animateTransform",
    ).length;
    return { values, smilNodes };
  },

  /** Typography evidence (review R1): nav controls must use the production face. */
  probeTypography() {
    const body = getComputedStyle(document.body).fontFamily;
    const entry = document.querySelector("[data-nav-entry]");
    const button = entry ? getComputedStyle(entry).fontFamily : null;
    const fontFaces = [...document.fonts].map((face) => `${face.family}/${face.weight}`).sort();
    return { body, button, fontFaces };
  },
};

void (async () => {
  renderCurrent();
  await settleAnimations();
})();
