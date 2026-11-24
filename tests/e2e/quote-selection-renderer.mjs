import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatWindow } from "../../src/renderer/components/ChatWindow.tsx";
import { ThinkingExpansionStore } from "../../src/renderer/lib/thinking-expansion-store.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installRendererApi } from "../support/renderer-api.mjs";
import { byRole } from "../support/dom-queries.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import { decodeComposerQuoteToken } from "../../src/shared/quote-tokens.ts";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
setAppLanguage("en-US");

const ASSISTANT_ENTRY = "assistant-target";
const SELECTION_TEXT = "bold alpha and inline-code beta";
const chatInputRef = createRef();
const root = createRoot(document.getElementById("root"));
const thinkingExpansionStore = new ThinkingExpansionStore();
const processDetailsExpansionStore = new ThinkingExpansionStore();
let activeDetail = null;
let activePages = {};
let epoch = 0;
let requests = [];

const host = createSessionTestHost({
  getSession: async () => activeDetail,
  getSessionContextPage: async (_sessionId, cursor) => {
    requests.push(cursor);
    const page = activePages[cursor];
    if (!page) throw new Error(`Missing quote history page ${cursor}`);
    return page;
  },
  agentState: async () => ({ running: false }),
});

const boundary = installRendererApi(window, { installApiShims, resetRpc }, () => host, { bridge: {} });

function chat() {
  return byRole(document, "region", "Chat");
}

function conversation() {
  return byRole(chat(), "region", "Conversation");
}

function editor() {
  return byRole(chat(), "textbox");
}

function entry(entryId) {
  return [...document.querySelectorAll("[data-quote-entry-id]")].find(
    (element) => element.getAttribute("data-quote-entry-id") === entryId,
  );
}

function bounds(element) {
  if (!element) return null;
  const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : element;
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
}

function composerQuotes() {
  return [...editor().querySelectorAll("[data-quote-token]")].map((element) => {
    const quote = decodeComposerQuoteToken(element.dataset.quotePayload ?? "");
    return quote ? { ...quote, rect: bounds(element) } : null;
  });
}

function bubbleQuotes(entryId) {
  const scope = entry(entryId);
  return scope
    ? [...scope.querySelectorAll("[data-quote-ref]")].map((element) => ({
        id: element.getAttribute("data-quote-ref"),
        label: element.textContent.trim(),
        rect: bounds(element),
      }))
    : [];
}

function bubbleQuoteState(entryId) {
  const scope = entry(entryId);
  const chip = scope?.querySelector("[data-quote-ref]");
  return chip
    ? {
        detached: chip.classList.contains("quote-chip-detached"),
        label: chip.textContent.trim(),
        rawXml: scope.textContent.includes("<quotes>"),
      }
    : null;
}

function sentUserQuote() {
  const chips = [...document.querySelectorAll('[data-quote-role="user"] [data-quote-ref]')];
  const chip = chips.at(-1);
  const scope = chip?.closest('[data-quote-role="user"]');
  return {
    count: chips.length,
    rawXml: Boolean(scope?.textContent.includes("<quotes>")),
    label: chip?.textContent.trim() ?? null,
  };
}

function textNodes(scope) {
  const nodes = [];
  const walker = document.createTreeWalker(scope, 4);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('button, [aria-hidden="true"]')) continue;
    nodes.push(node);
  }
  return nodes;
}

function pointForText(scope, needle) {
  const nodes = textNodes(scope);
  const full = nodes.map((node) => node.data).join("");
  const startOffset = full.indexOf(needle);
  if (startOffset < 0) throw new Error(`Unable to locate text ${needle}`);
  const endOffset = startOffset + needle.length;
  let position = 0;
  let startNode;
  let endNode;
  let startInNode = 0;
  let endInNode = 0;
  for (const node of nodes) {
    const next = position + node.data.length;
    if (!startNode && startOffset >= position && startOffset <= next) {
      startNode = node;
      startInNode = startOffset - position;
    }
    if (endOffset >= position && endOffset <= next) {
      endNode = node;
      endInNode = endOffset - position;
      break;
    }
    position = next;
  }
  if (!startNode || !endNode) throw new Error(`Unable to make a range for ${needle}`);
  const range = document.createRange();
  range.setStart(startNode, startInNode);
  range.setEnd(endNode, endInNode);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) throw new Error(`Text ${needle} has no visible rectangle`);
  const first = rects[0];
  const last = rects.at(-1);
  return {
    start: { x: Math.round(first.left + 1), y: Math.round(first.top + first.height / 2) },
    end: { x: Math.round(last.right - 1), y: Math.round(last.top + last.height / 2) },
    rects: rects.map((rect) => bounds(rect)),
  };
}

function assistantSelectionPoints(needle = SELECTION_TEXT) {
  const scope = entry(ASSISTANT_ENTRY);
  if (!scope) throw new Error("The selection assistant message is not rendered");
  return pointForText(scope, needle);
}

function composerSelectionPoints() {
  const scope = editor();
  return pointForText(scope, scope.textContent.trim());
}

function assistantPoint(entryId = ASSISTANT_ENTRY) {
  const scope = entry(entryId);
  if (!scope) throw new Error(`Missing assistant entry ${entryId}`);
  const target = scope.querySelector(".chat-reading") ?? scope;
  const rect = target.getBoundingClientRect();
  return { x: Math.round(rect.left + Math.min(120, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) };
}

function composerQuoteCenter(index = 0) {
  const chip = editor().querySelectorAll("[data-quote-token]")[index];
  if (!chip) return null;
  const rect = chip.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

function bubbleQuoteCenter(entryId, index = 0) {
  const chip = entry(entryId)?.querySelectorAll("[data-quote-ref]")[index];
  if (!chip) return null;
  const rect = chip.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

function messageState(entryId) {
  const message = entry(entryId);
  const viewport = conversation();
  const messageRect = bounds(message);
  const viewportRect = bounds(viewport);
  return {
    exists: Boolean(message),
    rect: messageRect,
    viewport: viewportRect,
    visible: Boolean(
      messageRect && viewportRect && messageRect.bottom > viewportRect.top && messageRect.top < viewportRect.bottom,
    ),
    fullyVisible: Boolean(
      messageRect && viewportRect && messageRect.top >= viewportRect.top && messageRect.bottom <= viewportRect.bottom,
    ),
    highlighted: Boolean(message?.hasAttribute("data-quote-flash") || message?.querySelector("[data-quote-flash]")),
  };
}

function selectionPopover() {
  const button = document.querySelector(".selection-quote-pill");
  return button ? { label: button.textContent.trim(), rect: bounds(button) } : null;
}

function detachedPreview() {
  const floating = document.querySelector(".quote-preview-floating");
  if (!floating) return null;
  return {
    rect: bounds(floating),
    text: floating.querySelector(".quote-preview-text")?.textContent ?? "",
    hint: floating.querySelector(".quote-preview-hint")?.textContent ?? "",
  };
}

function sentPrompts() {
  return host.sendCommands
    .filter((command) => command.payload?.type === "prompt")
    .map((command) => command.payload.message);
}

window.quoteSelection = {
  load(payload) {
    activeDetail = payload.detail;
    activePages = payload.pages ?? {};
    requests = [];
    host.sendCommands.length = 0;
    epoch += 1;
    flushSync(() =>
      root.render(
        createElement(ChatWindow, {
          key: epoch,
          session: activeDetail.info,
          newSessionCwd: null,
          chatInputRef,
          thinkingExpansionStore,
          processDetailsExpansionStore,
          onSessionCreated() {},
          onAgentEnd() {},
          onOpenFile() {},
        }),
      ),
    );
  },
  assistantSelectionPoints,
  composerSelectionPoints,
  assistantPoint,
  composerQuoteCenter,
  bubbleQuoteCenter,
  composerQuotes,
  bubbleQuotes,
  bubbleQuoteState,
  sentUserQuote,
  messageState,
  selectionPopover,
  detachedPreview,
  sentPrompts,
  requests: () => [...requests],
  draft: () => editor().textContent,
  composerFocused: () => document.activeElement === editor(),
  insertQuote(quote) {
    chatInputRef.current?.insertQuoteAtCaret(quote);
  },
  insertText(text) {
    chatInputRef.current?.insertText(text);
  },
  focusComposer() {
    editor().focus();
  },
  scrollToBottom() {
    const target = conversation();
    target.scrollTop = target.scrollHeight;
  },
  scrollToEntry(entryId) {
    entry(entryId)?.scrollIntoView({ block: "center" });
  },
  blankPoint() {
    return { x: 5, y: 5 };
  },
  close() {
    try {
      flushSync(() => root.unmount());
    } finally {
      boundary.close();
    }
  },
};
