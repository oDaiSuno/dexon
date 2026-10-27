import assert from "node:assert/strict";
import { act, dom } from "./renderer.mjs";
import { waitFor } from "./dom-events.mjs";
import { createSessionTestHost } from "../fixtures/session-host.mjs";
import { createBrowserObservers } from "./browser-observers.mjs";

export function layOutConversation(t, container, { viewHeight, contentHeight, questionTops }) {
  Object.defineProperty(container, "clientHeight", { configurable: true, get: () => viewHeight });
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

export async function scrollConversationTo(container, top) {
  await act(async () => {
    container.scrollTop = top;
    container.dispatchEvent(new dom.window.Event("scroll"));
  });
}

export function installResizeObservers(t) {
  const observers = createBrowserObservers();
  const original = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: observers.ResizeObserver });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "ResizeObserver", original);
    else delete globalThis.ResizeObserver;
  });
  return observers;
}

export function installBrowserEventGlobals(t) {
  const names = ["KeyboardEvent", "WheelEvent", "TouchEvent"];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  t.after(() => {
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  });
}

export function heldPagesHost(detail, pages, overrides = {}) {
  const waiting = new Map();
  const host = createSessionTestHost({
    getSession: async () => detail,
    getSessionContextPage: (_sid, cursor) =>
      new Promise((resolve, reject) => {
        waiting.set(cursor, { resolve, reject });
      }),
    ...overrides,
  });
  const requests = () =>
    host.getCommands.filter((command) => command.rpc === "getSessionContextPage").map((command) => command.args[0]);
  const awaitRequest = (cursor) =>
    waitFor(() => {
      assert.ok(waiting.has(cursor), `the renderer asked the host for ${cursor}`);
      return waiting.get(cursor);
    });
  return {
    host,
    requests,
    async release(cursor) {
      const entry = await awaitRequest(cursor);
      waiting.delete(cursor);
      await act(async () => entry.resolve(pages[cursor]));
    },
    async fail(cursor) {
      const entry = await awaitRequest(cursor);
      waiting.delete(cursor);
      await act(async () => entry.reject(new Error("Host read failed")));
    },
  };
}
