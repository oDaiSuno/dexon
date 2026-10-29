import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatWindow } from "../../src/renderer/components/ChatWindow.tsx";
import { ThinkingExpansionStore } from "../../src/renderer/lib/thinking-expansion-store.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installApiHostBridge } from "../support/api-host.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import { byRole } from "../support/dom-queries.mjs";
import "./production-styles.mjs";

const window = globalThis.window;
const document = globalThis.document;
setAppLanguage("en-US");

let detail = null;
let pages = {};
let autoRelease = false;
let held = [];
let requests = [];
let epoch = 0;
let streamTimer = null;
let streaming = false;
let streamTicks = 0;
const STREAM_PARAGRAPH_LIMIT = 240;

const host = createSessionTestHost({
  getSession: async () => detail,
  getSessionContextPage: (_sid, cursor) => {
    requests.push(cursor);
    const reply = pages[cursor];
    if (!reply) return Promise.reject(new Error(`No fixture page for cursor ${cursor}`));
    if (autoRelease) return Promise.resolve(reply);
    return new Promise((resolve, reject) => {
      held.push({ cursor, resolve, reject });
    });
  },
  agentState: async () => (streaming ? { running: true, state: { isStreaming: true } } : { running: false }),
});

window.piBridge = {};
const boundary = installApiHostBridge(window, () => host, resetRpc);
const root = createRoot(document.getElementById("root"));
const thinkingExpansionStore = new ThinkingExpansionStore();
const processDetailsExpansionStore = new ThinkingExpansionStore();

const chatOf = () => byRole(document, "region", "Chat");
const conversationOf = () => {
  const chat = chatOf();
  return chat ? byRole(chat, "region", "Conversation") : undefined;
};
const messagesOf = () => {
  const conversation = conversationOf();
  return conversation ? byRole(conversation, "group", "Messages") : undefined;
};
const navigatorOf = () => {
  const chat = chatOf();
  return chat ? byRole(chat, "navigation", "Conversation navigator") : undefined;
};
const earlierOf = () => {
  const conversation = conversationOf();
  return conversation ? byRole(conversation, "group", "Earlier messages") : undefined;
};
const spacerOf = () => {
  const conversation = conversationOf();
  return conversation ? conversation.querySelector("[data-run-spacer]") : null;
};
const composerOf = () => {
  const chat = chatOf();
  return chat ? byRole(chat, "group", "Message input") : undefined;
};
const editorOf = () => {
  const composer = composerOf();
  return composer ? byRole(composer, "textbox") : undefined;
};

function emit(event) {
  for (const sink of host.eventSinks) if (sink.active) sink.onEvent(event);
}

function resetStream() {
  streaming = false;
  if (streamTimer !== null) window.clearInterval(streamTimer);
  streamTimer = null;
}

function bounds(element) {
  const rect = element.getBoundingClientRect();
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

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

function leafFor(prefix) {
  const area = messagesOf();
  if (!area) return null;
  const nodes = [...area.querySelectorAll("*")];
  return (
    nodes.find((node) => node.children.length === 0 && node.textContent.trim().startsWith(prefix)) ??
    nodes.find((node) => node.textContent.trim().startsWith(prefix)) ??
    null
  );
}

function topWithin(element, origin) {
  return element.getBoundingClientRect().top - origin.getBoundingClientRect().top;
}

window.chatHistory = {
  load(payload) {
    detail = payload.detail;
    pages = payload.pages;
    requests = [];
    held = [];
    autoRelease = false;
    resetStream();
    epoch += 1;
    flushSync(() =>
      root.render(
        createElement(ChatWindow, {
          key: epoch,
          session: detail.info,
          newSessionCwd: null,
          thinkingExpansionStore,
          processDetailsExpansionStore,
          onSessionCreated() {},
          onAgentEnd() {},
          onOpenFile() {},
        }),
      ),
    );
  },
  reload() {
    if (!detail) throw new Error("No conversation was loaded");
    window.chatHistory.load({ detail, pages });
  },
  state() {
    const conversation = conversationOf();
    const area = messagesOf();
    const style = conversation ? window.getComputedStyle(conversation) : null;
    const spacer = spacerOf();
    const spacerHeight = spacer ? spacer.offsetHeight : 0;
    const scrollHeight = conversation ? conversation.scrollHeight : 0;
    const clientHeight = conversation ? conversation.clientHeight : 0;
    const scrollTop = conversation ? conversation.scrollTop : 0;
    return {
      ready: Boolean(conversation && area) && !document.body.textContent.includes("Loading session..."),
      requests: requests.length,
      cursors: [...requests],
      pending: held.length,
      atBottom: conversation ? scrollHeight - clientHeight - scrollTop <= 2 : false,
      scrollTop,
      scrollHeight,
      clientHeight,
      clientWidth: conversation ? conversation.clientWidth : 0,
      offsetWidth: conversation ? conversation.offsetWidth : 0,
      scrollbarWidth: style ? style.scrollbarWidth : null,
      scrollbarGutter: style ? style.scrollbarGutter : null,
      spacer: spacerHeight,
      distanceToLiveEnd: Math.round(scrollHeight - spacerHeight - clientHeight - scrollTop),
      prompts: host.sendCommands.filter((command) => command.payload?.type === "prompt").length,
      streaming,
      transcript: area ? area.textContent.length : 0,
      navigator: Boolean(navigatorOf()),
    };
  },
  thumb(target = null) {
    const conversation = conversationOf();
    if (!conversation) return null;
    const rect = conversation.getBoundingClientRect();
    const track = Math.max(1, conversation.scrollHeight - conversation.clientHeight);
    const length = Math.max(20, (conversation.clientHeight * conversation.clientHeight) / conversation.scrollHeight);
    const travel = Math.max(0, conversation.clientHeight - length);
    const position = target === null ? conversation.scrollTop : Math.min(track, Math.max(0, target));
    return {
      x: rect.left + conversation.offsetWidth - 4,
      y: rect.top + (position / track) * travel + length / 2,
      length,
      travel,
      track,
      top: rect.top,
      bottom: rect.bottom,
    };
  },
  earlier() {
    const earlier = earlierOf();
    if (!earlier) return { present: false, text: "", rect: null };
    return { present: true, text: earlier.textContent.trim(), rect: bounds(earlier) };
  },
  composer() {
    const editor = editorOf();
    return editor ? bounds(editor) : null;
  },
  draft() {
    const editor = editorOf();
    return editor ? editor.textContent : null;
  },
  focusComposer() {
    const editor = editorOf();
    if (!editor) return false;
    editor.focus();
    return document.activeElement === editor;
  },
  target(x, y) {
    const element = document.elementFromPoint(x, y);
    const conversation = conversationOf();
    const area = messagesOf();
    if (!element) return null;
    return {
      isScroller: element === conversation,
      inMessages: Boolean(area && area.contains(element)),
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
    };
  },
  prosePoint() {
    const conversation = conversationOf();
    const area = messagesOf();
    if (!conversation || !area) return null;
    const origin = conversation.getBoundingClientRect().top;
    const band = conversation.clientHeight;
    let best = null;
    for (const node of area.querySelectorAll("*")) {
      if (node.children.length > 0) continue;
      const text = node.textContent.trim();
      if (text.length < 20) continue;
      const rect = node.getBoundingClientRect();
      if (rect.height <= 0 || rect.width < 120) continue;
      const top = rect.top - origin;
      if (top < 60 || top > band - 120) continue;
      if (!best || Math.abs(top - band / 2) < Math.abs(best.top - band / 2)) best = { rect, top, text };
    }
    if (!best) return null;
    return {
      x: best.rect.left + 80,
      y: best.rect.top + best.rect.height / 2,
      top: Math.round(best.top),
      height: Math.round(best.rect.height),
      text: best.text.slice(0, 60),
    };
  },
  startStream() {
    if (streamTimer !== null) window.clearInterval(streamTimer);
    streaming = true;
    streamTicks = 0;
    emit({ type: "agent_start" });
    streamTimer = window.setInterval(() => {
      streamTicks += 1;
      const paragraphs = Math.min(STREAM_PARAGRAPH_LIMIT, streamTicks);
      const text = Array.from(
        { length: paragraphs },
        (_value, index) =>
          `Streaming paragraph ${index + 1} keeps the reply growing while the reader holds the scrollbar.`,
      ).join("\n\n");
      emit({
        type: "message_update",
        message: {
          role: "assistant",
          provider: "fixture",
          model: "fixture-model",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text }],
        },
      });
    }, 90);
  },
  stopStream() {
    resetStream();
    emit({ type: "agent_end" });
  },
  conversation() {
    const conversation = conversationOf();
    return conversation ? bounds(conversation) : null;
  },
  navigator() {
    const nav = navigatorOf();
    if (!nav) return { present: false, buttons: [], scroller: null, rect: null };
    const buttons = [...nav.querySelectorAll("button")].map((node) => ({
      name: (node.getAttribute("aria-label") ?? node.textContent ?? "").trim(),
      current: node.getAttribute("aria-current") === "true",
      rect: bounds(node),
    }));
    const scroller =
      [nav, ...nav.querySelectorAll("*")].find(
        (node) =>
          node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(window.getComputedStyle(node).overflowY),
      ) ?? nav;
    const style = window.getComputedStyle(nav);
    return {
      present: true,
      rect: bounds(nav),
      own: {
        scrollHeight: nav.scrollHeight,
        clientHeight: nav.clientHeight,
        maxHeight: parseFloat(style.maxHeight),
        paddingBlock: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
        capacity: (nav.offsetParent?.clientHeight ?? 0) - 96,
      },
      buttons,
      scroller: {
        rect: bounds(scroller),
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      },
    };
  },
  button(name) {
    const chat = chatOf();
    if (!chat) return null;
    const node = [...chat.querySelectorAll("button")].find(
      (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "").trim() === name,
    );
    return node ? bounds(node) : null;
  },
  scrollToBottom() {
    const conversation = conversationOf();
    if (!conversation) return 0;
    conversation.scrollTop = conversation.scrollHeight;
    return conversation.scrollTop;
  },
  scrollToMiddle() {
    const conversation = conversationOf();
    if (!conversation) return 0;
    conversation.scrollTop = Math.round((conversation.scrollHeight - conversation.clientHeight) / 2);
    return conversation.scrollTop;
  },
  scrollTop() {
    const conversation = conversationOf();
    return conversation ? conversation.scrollTop : 0;
  },
  sentencesBetween(minTop, maxTop) {
    const conversation = conversationOf();
    const area = messagesOf();
    if (!conversation || !area) return [];
    const origin = conversation.getBoundingClientRect().top;
    const found = [];
    for (const node of area.querySelectorAll("*")) {
      if (node.children.length > 0) continue;
      const text = node.textContent.trim();
      if (text.length < 20) continue;
      const rect = node.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) continue;
      const top = rect.top - origin;
      if (top < minTop || top > maxTop) continue;
      found.push({ text: text.slice(0, 120), top });
    }
    return found;
  },
  positionOf(prefix) {
    const conversation = conversationOf();
    const node = leafFor(prefix);
    return conversation && node ? topWithin(node, conversation) : null;
  },
  messageTop(prefix) {
    const conversation = conversationOf();
    const leaf = leafFor(prefix);
    if (!conversation || !leaf) return null;
    const limit = leaf.textContent.trim().length + 200;
    let node = leaf;
    while (node.parentElement) {
      const parent = node.parentElement;
      if (parent.getAttribute("role") === "group") break;
      const text = parent.textContent.trim();
      if (!text.startsWith(prefix) || countOf(text, prefix) !== 1) break;
      if (text.length > limit) break;
      node = parent;
    }
    return topWithin(node, conversation);
  },
  occurrences(prefix) {
    const area = messagesOf();
    const text = area ? area.textContent : "";
    return { count: countOf(text, prefix), index: text.indexOf(prefix), length: text.length };
  },
  order(prefixes) {
    const area = messagesOf();
    const text = area ? area.textContent : "";
    return prefixes.map((prefix) => ({
      prefix,
      count: countOf(text, prefix),
      index: text.indexOf(prefix),
    }));
  },
  release() {
    const next = held.shift();
    if (!next) return false;
    next.resolve(pages[next.cursor]);
    return true;
  },
  autoRelease(enabled) {
    autoRelease = Boolean(enabled);
  },
  close() {
    try {
      resetStream();
      flushSync(() => root.unmount());
    } finally {
      boundary.close();
    }
  },
};
