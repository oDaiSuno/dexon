import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ChatWindow } from "../../src/renderer/components/ChatWindow.tsx";
import { applyChatAppearance } from "../../src/renderer/lib/chat-appearance.ts";
import { ThinkingExpansionStore } from "../../src/renderer/lib/thinking-expansion-store.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { installApiShims } from "../../src/renderer/lib/api-fetch.ts";
import { resetRpc } from "../../src/renderer/lib/api-client.ts";
import { installRendererApi } from "../../tests/support/renderer-api.mjs";
import { createSessionTestHost } from "../../tests/fixtures/session-host.mjs";
import { createSessionDetail } from "../../src/renderer/hooks/agent-session/session-hook-fixtures.mjs";
import "../../tests/e2e/production-styles.mjs";
import { MessageRenderKeyRegistry } from "../../src/renderer/lib/message-render-key.ts";
import { userMessageKey } from "../../src/renderer/hooks/agent-session/shared.ts";
if (new URLSearchParams(location.search).has("alias")) {
  const original = MessageRenderKeyRegistry.prototype.keyFor;
  MessageRenderKeyRegistry.prototype.keyFor = function (message, entryId, role) {
    this.__pending ??= new Map(); this.__bound ??= new Map();
    if (message.role === "user") {
      const content = userMessageKey(message);
      if (!entryId) { const key = original.call(this, message, entryId, role); this.__pending.set(content, key.slice(0, key.lastIndexOf(":"))); return key; }
      if (this.__bound.has(entryId)) return `${this.__bound.get(entryId)}:${role}`;
      if (this.__pending.has(content)) { const base = this.__pending.get(content); this.__pending.delete(content); this.__bound.set(entryId, base); return `${base}:${role}`; }
    }
    return original.call(this, message, entryId, role);
  };
}
import { captureReadingAnchor, alignReadingPosition } from "../../src/renderer/lib/reading-anchor.ts";

setAppLanguage("zh-CN");
const LONG = ["LONGMARK 帮我把会话导出功能重做一遍，下面是这周收集到的全部问题："]
  .concat(Array.from({ length: 59 }, (_, i) => `${i + 1}. 第 ${i + 1} 条反馈：导出 Markdown 时工具调用参数被吞掉，需要折叠成 details 块。`))
  .join("\n");
const reply = (text, ts) => ({ role: "assistant", content: [{ type: "text", text }], provider: "f", model: "f", stopReason: "stop", timestamp: ts });
const messages = [{ role: "user", content: LONG, timestamp: 1 }, reply("第一条回复", 2)];
for (let i = 0; i < 30; i++) messages.push({ role: "user", content: `短问题 ${i}`, timestamp: 3 + i * 2 }, reply(`回复 ${i}\n\n` + "段落文字。".repeat(80), 4 + i * 2));
const detail = createSessionDetail("poc", { messages, entryIds: messages.map((_, i) => `e${i}`) });
let current = detail;
const host = { ...createSessionTestHost({ getSession: async () => current, agentState: async () => ({ running: false }) }),
  call(method) { if (method === "files.index") return { files: [], truncated: false }; if (method === "skills.list") return { skills: [] }; if (method === "agent.generateTitle") return { title: null }; throw new Error(method); } };
const boundary = installRendererApi(window, { installApiShims, resetRpc }, () => host);
const root = createRoot(document.getElementById("root"));
function render(fontSize = "standard") {
  applyChatAppearance(document.documentElement, { fontSize, layout: "fixed" });
  document.getElementById("root").style.height = "100vh";
  flushSync(() => root.render(createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
    createElement(ChatWindow, { session: detail.info, newSessionCwd: null, thinkingExpansionStore: new ThinkingExpansionStore(), processDetailsExpansionStore: new ThinkingExpansionStore(), onSessionCreated() {}, onAgentEnd() {}, onOpenFile() {} }))));
}
const bubble = () => [...document.querySelectorAll("[data-message-source]")].find((e) => e.textContent.includes("LONGMARK"));
const scroller = () => document.querySelector("[role=region].overflow-y-auto");
window.poc = {
  render,
  baseline() {
    const b = bubble(); const md = b.querySelector(".markdown-user-message"); const cs = getComputedStyle(md);
    const lh = parseFloat(cs.lineHeight);
    return { viewport: scroller().clientHeight, bubbleHeight: b.getBoundingClientRect().height, bubbleWidth: b.getBoundingClientRect().width,
      proseHeight: md.getBoundingClientRect().height, lineHeight: lh, fontSize: parseFloat(cs.fontSize),
      visualLines: Math.round(md.getBoundingClientRect().height / lh), screens: +(b.getBoundingClientRect().height / scroller().clientHeight).toFixed(2) };
  },
  scrollBottom() { const s = scroller(); s.scrollTop = s.scrollHeight; },
  offscreenProbe() {
    const b = bubble(); const item = b.closest(".chat-history-item"); const md = b.querySelector(".markdown-user-message");
    const s = scroller(); const r = item.getBoundingClientRect(); const sr = s.getBoundingClientRect();
    return { itemOffscreen: r.bottom < sr.top || r.top > sr.bottom, cv: getComputedStyle(item).contentVisibility,
      mdScrollHeight: md.scrollHeight, mdRectHeight: md.getBoundingClientRect().height, itemRectHeight: r.height };
  },
  observe() {
    const md = bubble().querySelector(".markdown-user-message"); window.__ro = [];
    new ResizeObserver((es) => es.forEach((e) => window.__ro.push(Math.round(e.contentRect.height)))).observe(md);
  },
  roLog() { return window.__ro; },
  setWidth(px) { document.getElementById("root").style.width = px + "px"; },
  supports() { return { interpolateSize: CSS.supports("interpolate-size", "allow-keywords"), calcSize: CSS.supports("height", "calc-size(auto, size)"), mask: CSS.supports("mask-image", "linear-gradient(#000,transparent)"), overflowAnchor: getComputedStyle(scroller()).overflowAnchor, lhUnit: CSS.supports("height", "8lh") }; },
  close() { flushSync(() => root.unmount()); boundary.close(); },
};
render();
window.poc.collapseProbe = function (mode) {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message");
  const lh = parseFloat(getComputedStyle(md).lineHeight);
  const sr = s.getBoundingClientRect();
  const bottomAbs = b.getBoundingClientRect().bottom - sr.top + s.scrollTop;
  s.scrollTop = bottomAbs - s.clientHeight + 40;
  const before = { scrollTop: s.scrollTop, bubbleTopInView: b.getBoundingClientRect().top - sr.top };
  md.style.maxHeight = 8 * lh + "px"; md.style.overflow = "hidden";
  if (mode === "anchor-none") s.style.overflowAnchor = "none";
  void s.offsetHeight;
  const after = { scrollTop: s.scrollTop, bubbleTop: b.getBoundingClientRect().top - sr.top, bubbleBottom: b.getBoundingClientRect().bottom - sr.top, viewport: s.clientHeight };
  md.style.maxHeight = ""; md.style.overflow = ""; s.style.overflowAnchor = "";
  return { mode, before, after, bubbleTopVisible: after.bubbleTop >= 0 && after.bubbleTop < s.clientHeight };
};
window.poc.maskFade = function (theme) {
  const b = bubble(); const md = b.querySelector(".markdown-user-message");
  md.style.maxHeight = "200px"; md.style.overflow = "hidden";
  md.style.maskImage = "linear-gradient(180deg,#000 62%,transparent)";
  b.scrollIntoView({ block: "center" });
  return { mask: getComputedStyle(md).maskImage };
};
window.poc.proto = function () {
  const md = bubble().querySelector(".markdown-user-message");
  md.style.cssText = ""; md.dataset.proto = "1";
  const style = document.createElement("style");
  style.textContent = `.markdown-user-message[data-clamped]{max-height:8lh;overflow:hidden;mask-image:linear-gradient(180deg,#000 62%,transparent);interpolate-size:allow-keywords;transition:max-height 220ms cubic-bezier(.23,1,.32,1)}`;
  document.head.appendChild(style);
  window.__decisions = [];
  const decide = () => {
    const lh = parseFloat(getComputedStyle(md).lineHeight);
    const lines = md.scrollHeight / lh;
    const clamp = lines > 12;
    if (clamp) md.dataset.clamped = ""; else delete md.dataset.clamped;
    window.__decisions.push({ t: Math.round(performance.now()), lines: +lines.toFixed(1), clamp, shown: Math.round(md.getBoundingClientRect().height), lh });
  };
  decide();
  new ResizeObserver(() => setTimeout(decide, 0)).observe(md);
  return window.__decisions.at(-1);
};
window.poc.decisions = () => window.__decisions;
window.poc.compensatedCollapse = function () {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message");
  delete md.dataset.clamped; md.style.transition = "none"; void md.offsetHeight;
  const sr = s.getBoundingClientRect();
  s.scrollTop = b.getBoundingClientRect().bottom - sr.top + s.scrollTop - s.clientHeight + 40;
  const before = b.getBoundingClientRect().top - sr.top;
  const dbg = { scrollTop: s.scrollTop, bubbleH: b.getBoundingClientRect().height, mdH: md.getBoundingClientRect().height, scrollH: s.scrollHeight };
  md.dataset.clamped = ""; void md.offsetHeight;
  const top = b.getBoundingClientRect().top - sr.top;
  if (top < 0) s.scrollTop += top - 16;
  const after = b.getBoundingClientRect().top - s.getBoundingClientRect().top;
  md.style.transition = "";
  return { dbg, bubbleTopBefore: Math.round(before), bubbleTopAfterCompensation: Math.round(after), scrollTopAfter: s.scrollTop };
};
window.poc.tagBubble = () => { bubble().__tag = "same-node"; return true; };
window.poc.bubbleTag = () => bubble()?.__tag ?? null;

const LIVE = "LIVEMARK " + Array.from({ length: 40 }, (_, i) => `实时长消息第 ${i + 1} 行`).join("\n");
const emit = (event) => { for (const sink of host.eventSinks.filter((x) => x.active)) sink.onEvent(event); };
const liveBubble = () => [...document.querySelectorAll("[data-message-source]")].find((e) => e.textContent.includes("LIVEMARK"));
window.poc.liveTurnStart = () => {
  emit({ type: "agent_start" });
  emit({ type: "message_end", message: { role: "user", content: LIVE, timestamp: 900 } });
  return true;
};
window.poc.liveTag = () => { const b = liveBubble(); if (!b) return null; b.__tag = "kept"; return { key: b.closest("[data-reading-anchor]")?.getAttribute("data-reading-anchor") }; };
window.poc.liveTurnEnd = () => {
  const userMsg = { role: "user", content: LIVE, timestamp: 900 };
  const ans = { role: "assistant", content: [{ type: "text", text: "实时回复" }], provider: "f", model: "f", stopReason: "stop", timestamp: 901 };
  const all = [...messages, userMsg, ans];
  current = createSessionDetail("poc", { messages: all, entryIds: all.map((_, i) => `e${i}`) });
  emit({ type: "message_end", message: ans });
  emit({ type: "agent_end" });
  return true;
};
window.poc.liveAfter = () => { const b = liveBubble(); return b ? { sameNode: b.__tag === "kept", key: b.closest("[data-reading-anchor]")?.getAttribute("data-reading-anchor") } : null; };

window.poc.restoreProbe = function () {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message");
  delete md.dataset.clamped; md.style.cssText = "transition:none"; void md.offsetHeight;
  const sr = s.getBoundingClientRect();
  s.scrollTop = b.getBoundingClientRect().top - sr.top + s.scrollTop + 1000;
  const anchor = captureReadingAnchor(s);
  md.dataset.clamped = ""; void md.offsetHeight;
  return new Promise((resolve) => {
    alignReadingPosition({ container: s, target: anchor.offsetTop,
      measure: () => { const el = s.querySelector(`[data-reading-anchor="${CSS.escape(anchor.key)}"]`); return el ? el.getBoundingClientRect().top - s.getBoundingClientRect().top : null; },
      onSettled: () => {
        const top = document.elementFromPoint(s.getBoundingClientRect().left + s.clientWidth / 2, s.getBoundingClientRect().top + 40);
        resolve({ anchor, bubbleTopAfter: Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top), bubbleBottomAfter: Math.round(b.getBoundingClientRect().bottom - s.getBoundingClientRect().top), textAtViewportTop: (top?.closest("[data-reading-anchor]")?.textContent ?? "").slice(0, 30) });
      } });
  });
};

window.poc.cvFresh = function () {
  const s = scroller();
  const host2 = document.createElement("div");
  host2.className = "chat-history-item";
  const inner = document.createElement("div");
  inner.className = "markdown-body"; inner.style.whiteSpace = "pre-wrap";
  inner.textContent = Array.from({ length: 60 }, (_, i) => "离屏新插入第 " + i + " 行").join("\n");
  host2.appendChild(inner);
  const column = s.querySelector(".chat-content-column");
  s.scrollTop = s.scrollHeight;
  column.insertBefore(host2, column.firstChild);
  const sync = { scrollHeight: inner.scrollHeight, rect: Math.round(inner.getBoundingClientRect().height) };
  return new Promise((resolve) => {
    const seen = [];
    new ResizeObserver((es) => es.forEach((e) => seen.push(Math.round(e.contentRect.height)))).observe(inner);
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      const hostRect = host2.getBoundingClientRect();
      resolve({ sync, resizeObserverSaw: seen, hostOffscreen: hostRect.bottom < s.getBoundingClientRect().top, cv: getComputedStyle(host2).contentVisibility });
    }, 200)));
  });
};
window.poc.focusProbe = function () {
  const b = bubble(); const md = b.querySelector(".markdown-user-message");
  const btn = document.createElement("button"); btn.textContent = "hidden-chip";
  md.lastElementChild.appendChild(btn);
  md.style.cssText = "max-height:8lh;overflow:hidden"; void md.offsetHeight;
  btn.focus();
  const r = btn.getBoundingClientRect(); const m = md.getBoundingClientRect();
  return { focused: document.activeElement === btn, chipVisibleInsideClip: r.bottom <= m.bottom, mdScrollTopAfterFocus: md.scrollTop };
};
window.poc.forcedCost = function () {
  const s = scroller(); const items = [...s.querySelectorAll(".chat-history-item")];
  s.scrollTop = s.scrollHeight; void s.offsetHeight;
  items.forEach((i) => i.querySelectorAll(".markdown-body").forEach((m) => { m.textContent = m.textContent + " "; }));
  const t0 = performance.now(); let sum = 0;
  items.forEach((i) => i.querySelectorAll(".markdown-body").forEach((m) => { sum += m.scrollHeight; }));
  const t1 = performance.now();
  return { items: items.length, forcedMeasureMs: +(t1 - t0).toFixed(1) };
};
window.poc.cleanAnim = function (kind) {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const el = document.createElement("div"); el.className = "markdown-body chat-reading type-chat-body"; el.style.whiteSpace = "pre-wrap";
  el.textContent = Array.from({ length: 60 }, (_, i) => "动画测试第 " + i + " 行").join("\n");
  const st = document.createElement("style");
  st.textContent = kind === "interpolate"
    ? `.ca-i{interpolate-size:allow-keywords;overflow:hidden;height:auto;transition:height 220ms cubic-bezier(.23,1,.32,1)} .ca-i[data-c]{height:8lh}`
    : kind === "maxheight-none"
    ? `.ca-m{overflow:hidden;max-height:none;transition:max-height 220ms cubic-bezier(.23,1,.32,1)} .ca-m[data-c]{max-height:8lh}`
    : `.ca-g{display:grid;grid-template-rows:8lh;overflow:hidden;transition:grid-template-rows 220ms cubic-bezier(.23,1,.32,1)} .ca-g:not([data-c]){grid-template-rows:1fr}`;
  document.head.appendChild(st);
  el.classList.add(kind === "interpolate" ? "ca-i" : kind === "maxheight-none" ? "ca-m" : "ca-g");
  el.setAttribute("data-c", ""); col.insertBefore(el, col.firstChild); s.scrollTop = 0; void el.offsetHeight;
  const start = el.getBoundingClientRect().height;
  el.removeAttribute("data-c");
  return new Promise((resolve) => setTimeout(() => { const mid = el.getBoundingClientRect().height;
    setTimeout(() => { const end = el.getBoundingClientRect().height; el.setAttribute("data-c", ""); void el.offsetHeight;
      setTimeout(() => { const backMid = el.getBoundingClientRect().height; el.remove(); st.remove();
        resolve({ kind, start: Math.round(start), expand_at110ms: Math.round(mid), expand_at400ms: Math.round(end), collapse_at110ms: Math.round(backMid) }); }, 110); }, 290); }, 110));
};
window.poc.roReal = function (mode) {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const outer = document.createElement("div"); outer.className = "markdown-body chat-reading"; outer.style.whiteSpace = "pre-wrap";
  const inner = document.createElement("div"); inner.textContent = Array.from({ length: 13 }, (_, i) => "临界行 " + i).join("\n");
  outer.appendChild(inner); col.insertBefore(outer, col.firstChild); s.scrollTop = 0;
  let errors = 0; const onErr = (e) => { if (String(e.message).includes("ResizeObserver")) errors++; };
  window.addEventListener("error", onErr);
  const decide = () => { if (mode === "noop") return; const lh = parseFloat(getComputedStyle(outer).lineHeight);
    const natural = mode === "self" ? outer.scrollHeight : inner.getBoundingClientRect().height;
    const over = mode !== "noop" && natural / lh > 12.5;
    outer.style.maxHeight = over ? "8lh" : ""; outer.style.overflow = over ? "hidden" : ""; };
  const ro = new ResizeObserver(decide); ro.observe(mode === "self" ? outer : inner);
  if (mode === "raf") { ro.disconnect(); const ro2 = new ResizeObserver(() => requestAnimationFrame(() => { const lh = parseFloat(getComputedStyle(outer).lineHeight); const over = inner.getBoundingClientRect().height / lh > 12.5; outer.style.maxHeight = over ? "8lh" : ""; outer.style.overflow = over ? "hidden" : ""; })); ro2.observe(inner); window.__ro2 = ro2; }
  const steps = ["large", "small", "extra-large", "standard"];
  return new Promise((resolve) => { let i = 0; const tick = () => { if (i < steps.length) { document.documentElement.dataset.chatFontSize = steps[i++]; setTimeout(tick, 80); } else { ro.disconnect(); window.__ro2?.disconnect(); window.removeEventListener("error", onErr); outer.remove(); resolve({ mode, roLoopErrors: errors }); } }; tick(); });
};
window.poc.focusClip = function (overflow) {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const el = document.createElement("div"); el.className = "markdown-body"; el.style.whiteSpace = "pre-wrap";
  el.textContent = Array.from({ length: 40 }, (_, i) => "聚焦测试 " + i).join("\n");
  const btn = document.createElement("button"); btn.textContent = "chip"; el.appendChild(btn);
  el.style.maxHeight = "8lh"; el.style.overflow = overflow;
  col.insertBefore(el, col.firstChild); s.scrollTop = 0; void el.offsetHeight;
  btn.focus();
  const r = { overflow, innerScrollTop: el.scrollTop, firstLineStillVisible: el.firstChild.textContent.startsWith("聚焦测试 0") && el.scrollTop === 0, chipBelowClip: btn.getBoundingClientRect().top > el.getBoundingClientRect().bottom };
  el.remove(); return r;
};
window.poc.roAsync = function () {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const outer = document.createElement("div"); outer.className = "markdown-body chat-reading"; outer.style.whiteSpace = "pre-wrap";
  outer.textContent = Array.from({ length: 13 }, (_, i) => "临界行 " + i).join("\n");
  col.insertBefore(outer, col.firstChild); s.scrollTop = 0;
  let errors = 0; const onErr = (e) => { if (String(e.message).includes("ResizeObserver")) errors++; };
  window.addEventListener("error", onErr);
  const ro = new ResizeObserver(() => setTimeout(() => { const lh = parseFloat(getComputedStyle(outer).lineHeight); const over = outer.scrollHeight / lh > 12.5; outer.style.maxHeight = over ? "8lh" : ""; outer.style.overflow = over ? "clip" : ""; }, 0));
  ro.observe(outer);
  const steps = ["large", "small", "extra-large", "standard"];
  return new Promise((resolve) => { let i = 0; const tick = () => { if (i < steps.length) { document.documentElement.dataset.chatFontSize = steps[i++]; setTimeout(tick, 80); } else { ro.disconnect(); window.removeEventListener("error", onErr); outer.remove(); resolve({ mode: "deferred-to-next-task", roLoopErrors: errors }); } }; tick(); });
};
window.poc.liveReadPoint = function () {
  const s = scroller(); const b = liveBubble(); const sr = s.getBoundingClientRect();
  s.scrollTop += b.getBoundingClientRect().top - sr.top - 16;
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) };
};
window.poc.liveExpandSim = function () { liveBubble().querySelector(".markdown-user-message").style.paddingBottom = "1500px"; return Math.round(liveBubble().getBoundingClientRect().top - scroller().getBoundingClientRect().top); };
window.poc.liveStream = function (n) {
  emit({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "流式回复 ".repeat(n * 20) }], provider: "f", model: "f" } });
  return true;
};
window.poc.liveTop = () => Math.round(liveBubble().getBoundingClientRect().top - scroller().getBoundingClientRect().top);
window.poc.offscreenFontChange = async function () {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message"); const item = b.closest(".chat-history-item");
  const seen = []; const ro = new ResizeObserver((es) => es.forEach((e) => seen.push({ h: Math.round(e.contentRect.height), t: "ro" }))); ro.observe(md);
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))));
  await frames(); seen.length = 0;
  s.scrollTop = s.scrollHeight; await frames();
  const offscreen = item.getBoundingClientRect().bottom < s.getBoundingClientRect().top;
  document.documentElement.dataset.chatFontSize = "extra-large"; await frames();
  const whileOff = { roFired: seen.length, syncScrollHeight: md.scrollHeight, lineHeight: parseFloat(getComputedStyle(md).lineHeight) };
  b.scrollIntoView({ block: "start" }); await frames();
  const back = { roEvents: seen.slice(), finalHeight: Math.round(md.getBoundingClientRect().height) };
  ro.disconnect(); document.documentElement.dataset.chatFontSize = "standard";
  return { offscreen, whileOff, back };
};
import { useLayoutEffect as ule, useRef as ur, useState as us } from "react";
function ClampProbe({ text }) {
  const ref = ur(null); const [over, setOver] = us(false);
  ule(() => { const el = ref.current; const lh = () => parseFloat(getComputedStyle(el).lineHeight);
    const measure = () => setOver(el.scrollHeight / lh() > 12.5); measure();
    const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect(); }, []);
  return createElement("div", { ref, className: "markdown-body chat-reading", style: { whiteSpace: "pre-wrap", maxHeight: over ? "8lh" : undefined, overflow: over ? "clip" : undefined } }, text);
}
window.poc.reactRo = function () {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const holder = document.createElement("div"); col.insertBefore(holder, col.firstChild); s.scrollTop = 0;
  const r = createRoot(holder); flushSync(() => r.render(createElement(ClampProbe, { text: Array.from({ length: 13 }, (_, i) => "临界行 " + i).join("\n") })));
  let errors = 0; const onErr = (e) => { if (String(e.message).includes("ResizeObserver")) errors++; };
  window.addEventListener("error", onErr);
  const steps = ["large", "small", "extra-large", "standard"];
  return new Promise((resolve) => { let i = 0; const tick = () => { if (i < steps.length) { document.documentElement.dataset.chatFontSize = steps[i++]; setTimeout(tick, 80); } else { window.removeEventListener("error", onErr); r.unmount(); holder.remove(); resolve({ mode: "react-setState-in-observer", roLoopErrors: errors }); } }; tick(); });
};
window.poc.composer = () => { const g = document.querySelector('[role=group][aria-label]') ; const ed = [...document.querySelectorAll('[role=textbox]')].at(-1); ed.focus(); return !!ed; };
window.poc.sendButton = () => { const b = [...document.querySelectorAll("button[aria-label]")].find((x) => /发送|Send/.test(x.getAttribute("aria-label"))); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), disabled: b.disabled }; };
window.poc.sentTop = () => { const b = [...document.querySelectorAll("[data-message-source]")].find((e) => e.textContent.includes("SENTMARK")); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top - scroller().getBoundingClientRect().top), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 30) }; };
window.poc.sentExpand = () => { const b = [...document.querySelectorAll("[data-message-source]")].find((e) => e.textContent.includes("SENTMARK")); b.querySelector(".markdown-user-message").style.paddingBottom = "1500px"; return true; };
window.poc.restoreClamped = function () {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message");
  delete md.dataset.clamped; md.style.cssText = "transition:none"; void md.offsetHeight;
  const sr = s.getBoundingClientRect();
  s.scrollTop = b.getBoundingClientRect().top - sr.top + s.scrollTop + 1000;
  const anchor = captureReadingAnchor(s);
  md.dataset.clamped = ""; void md.offsetHeight;
  const el = () => s.querySelector(`[data-reading-anchor="${CSS.escape(anchor.key)}"]`);
  const height = el().getBoundingClientRect().height;
  const target = -anchor.offsetTop >= height ? 16 : anchor.offsetTop;
  return new Promise((resolve) => alignReadingPosition({ container: s, target,
    measure: () => el().getBoundingClientRect().top - s.getBoundingClientRect().top,
    onSettled: () => resolve({ anchor, currentAnchorHeight: Math.round(height), targetUsed: target, bubbleTopAfter: Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top) }) }));
};
window.poc.animatedCollapseOrder = function () {
  const s = scroller(); const b = bubble(); const md = b.querySelector(".markdown-user-message");
  delete md.dataset.clamped; md.style.cssText = "interpolate-size:allow-keywords;height:auto;overflow:clip;transition:height 220ms cubic-bezier(.23,1,.32,1)"; void md.offsetHeight;
  const sr = s.getBoundingClientRect();
  s.scrollTop = b.getBoundingClientRect().bottom - sr.top + s.scrollTop - s.clientHeight + 40;
  const before = Math.round(b.getBoundingClientRect().top - sr.top);
  const top = b.getBoundingClientRect().top - sr.top;
  if (top < 0) s.scrollTop += top - 16;
  md.style.height = "8lh";
  return new Promise((resolve) => setTimeout(() => {
    const mid = Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top);
    setTimeout(() => resolve({ bubbleTopBefore: before, bubbleTopDuringAnimation: mid, bubbleTopAfter: Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().top), proseHeightAfter: Math.round(md.getBoundingClientRect().height) }), 300);
  }, 110));
};
window.poc.clipScrollHeight = function () {
  const s = scroller(); const col = s.querySelector(".chat-content-column");
  const el = document.createElement("div"); el.className = "markdown-body chat-reading"; el.style.whiteSpace = "pre-wrap";
  const inner = document.createElement("div"); inner.textContent = Array.from({ length: 30 }, (_, i) => "裁切测量 " + i).join("\n"); el.appendChild(inner);
  col.insertBefore(el, col.firstChild); s.scrollTop = 0;
  const natural = el.scrollHeight;
  el.style.maxHeight = "8lh"; el.style.overflow = "clip"; void el.offsetHeight;
  const r = { natural, clipSelfScrollHeight: el.scrollHeight, clipInnerHeight: Math.round(inner.getBoundingClientRect().height), shown: Math.round(el.getBoundingClientRect().height) };
  el.remove(); return r;
};
