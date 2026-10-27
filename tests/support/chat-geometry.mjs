import assert from "node:assert/strict";
import { act, dom } from "./renderer.mjs";
import { roles } from "./app-navigation.mjs";

// JSDOM has no layout, so a conversation's heights, offsets and scroll offsets
// are supplied here: every message the fixtures put on screen occupies one row
// of `rowHeight`, in the order the fixtures list them. Prepending an older page
// therefore pushes the later rows down, as a real browser would.

const CONVERSATION = { role: "region", label: "Conversation" };
const EVENT_GLOBALS = ["WheelEvent", "KeyboardEvent"];
const CONTAINER_SELECTOR = `[role="${CONVERSATION.role}"][aria-label="${CONVERSATION.label}"]`;

let installed = null;

function isConversation(element) {
  return (
    element?.nodeType === 1 &&
    element.getAttribute("role") === CONVERSATION.role &&
    element.getAttribute("aria-label") === CONVERSATION.label
  );
}

function boxOf(top, bottom) {
  return { top, bottom, height: bottom - top, left: 0, right: 800, width: 800, x: 0, y: top };
}

function presentMarkers(container) {
  const text = container.textContent ?? "";
  return installed.markers.filter((marker) => text.includes(marker));
}

const RUN_SPACER = "[data-run-spacer]";

function rowsHeight(container) {
  return presentMarkers(container).length * installed.rowHeight;
}

// The conversation is exactly the messages: the running spacer is empty room
// the App adds below the newest message so a freshly sent question can reach
// the top of the view, not content. The App's own bottom check subtracts it
// the same way (see isNearChatBottom), so "at the bottom" means the end of the
// last message is at the bottom of the view.
function contentHeight(container) {
  return Math.max(rowsHeight(container), installed.viewHeight);
}

function spacerRoom(container) {
  return container.querySelector(RUN_SPACER) ? installed.viewHeight : 0;
}

function maxScrollTop(container) {
  return Math.max(contentHeight(container) + spacerRoom(container) - installed.viewHeight, 0);
}

function scrollTopOf(container) {
  return Math.min(Math.max(installed.scrollTops.get(container) ?? 0, 0), maxScrollTop(container));
}

function setScrollTop(container, value) {
  const next = Math.min(Math.max(Number(value) || 0, 0), maxScrollTop(container));
  const previous = installed.scrollTops.get(container) ?? 0;
  installed.scrollTops.set(container, next);
  if (next === previous || !container.isConnected) return;
  // A real browser reports the new offset on the next task, not inside the setter.
  setTimeout(() => {
    if (container.isConnected) container.dispatchEvent(new dom.window.Event("scroll"));
  }, 0);
}

function markerElement(container, marker, last) {
  const matches = [...container.querySelectorAll("*")].filter((element) =>
    (element.textContent ?? "").includes(marker),
  );
  return last ? matches.at(-1) : matches[0];
}

function rectOf(element, container) {
  const markers = presentMarkers(container);
  const scrollTop = scrollTopOf(container);
  const text = element.textContent ?? "";
  const own = markers.filter((marker) => text.includes(marker));
  if (own.length > 0) {
    const rowOf = new Map(markers.map((marker, index) => [marker, index]));
    return boxOf(
      rowOf.get(own[0]) * installed.rowHeight - scrollTop,
      (rowOf.get(own.at(-1)) + 1) * installed.rowHeight - scrollTop,
    );
  }
  const total = contentHeight(container);
  const rows = rowsHeight(container);
  const following = dom.window.Node.DOCUMENT_POSITION_FOLLOWING;
  const spacer = container.querySelector(RUN_SPACER);
  if (spacer === element) return boxOf(rows - scrollTop, rows + installed.viewHeight - scrollTop);
  if (spacer && spacer.compareDocumentPosition(element) & following) return boxOf(total - scrollTop, total - scrollTop);
  const last = markerElement(container, markers.at(-1), true);
  if (last && last.compareDocumentPosition(element) & following) {
    const end = spacer ? rows : total;
    return boxOf(end - scrollTop, end - scrollTop);
  }
  return boxOf(-scrollTop, -scrollTop);
}

export function conversation(scene) {
  assert.ok(installed, "installChatGeometry() must run before the conversation is measured");
  const regions = roles(scene.container, CONVERSATION.role, CONVERSATION.label);
  assert.equal(regions.length, 1, `Expected one conversation on screen; found ${regions.length}`);
  return regions[0];
}

export function topOf(scene, marker) {
  const container = conversation(scene);
  const matches = [...container.querySelectorAll("*")].filter((element) =>
    (element.textContent ?? "").includes(marker),
  );
  assert.ok(matches.length > 0, `The sentence “${marker}” is not on screen, so its height cannot be measured`);
  const innermost = matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
  return innermost[0].getBoundingClientRect().top - container.getBoundingClientRect().top;
}

export function distanceFromBottom(scene) {
  const container = conversation(scene);
  return container.scrollHeight - container.clientHeight - container.scrollTop;
}

export async function readerScrollsTo(scene, top) {
  const container = conversation(scene);
  await act(async () => {
    const from = container.scrollTop;
    container.dispatchEvent(
      new dom.window.WheelEvent("wheel", { deltaY: top < from ? -1 : 1, bubbles: true, cancelable: true }),
    );
    container.scrollTop = top;
    container.dispatchEvent(new dom.window.Event("scroll"));
  });
  await scene.settled();
}

export async function readerScrollsToBottom(scene) {
  const container = conversation(scene);
  await readerScrollsTo(scene, container.scrollHeight - container.clientHeight);
}

export function installChatGeometry(t, { markers, viewHeight = 600, rowHeight = 200 }) {
  assert.equal(installed, null, "Chat geometry is installed once per test");
  const elementPrototype = dom.window.Element.prototype;
  const htmlPrototype = dom.window.HTMLElement.prototype;
  const scrollTops = new WeakMap();
  installed = { markers: [...markers], viewHeight, rowHeight, scrollTops };

  const originalRect = Object.getOwnPropertyDescriptor(elementPrototype, "getBoundingClientRect");
  const originalClientHeight = Object.getOwnPropertyDescriptor(elementPrototype, "clientHeight");
  const originalScrollHeight = Object.getOwnPropertyDescriptor(elementPrototype, "scrollHeight");
  const originalScrollTop = Object.getOwnPropertyDescriptor(elementPrototype, "scrollTop");
  const patches = [
    [elementPrototype, "getBoundingClientRect", originalRect],
    [elementPrototype, "clientHeight", originalClientHeight],
    [elementPrototype, "scrollHeight", originalScrollHeight],
    [elementPrototype, "scrollTop", originalScrollTop],
    [htmlPrototype, "scrollIntoView", Object.getOwnPropertyDescriptor(htmlPrototype, "scrollIntoView")],
    [htmlPrototype, "scrollTo", Object.getOwnPropertyDescriptor(htmlPrototype, "scrollTo")],
  ];
  const containerOf = (element) =>
    isConversation(element) ? element : (element.closest?.(CONTAINER_SELECTOR) ?? null);

  // A browser has these event constructors; the Node globals the App is
  // evaluated with do not, and the App asks whether an event is one of them.
  for (const name of EVENT_GLOBALS) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    patches.push([globalThis, name, descriptor]);
    if (!descriptor)
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }

  Object.defineProperties(elementPrototype, {
    getBoundingClientRect: {
      configurable: true,
      writable: true,
      value: function getBoundingClientRect() {
        if (isConversation(this)) return boxOf(0, installed.viewHeight);
        const container = containerOf(this);
        if (!container) return originalRect.value.call(this);
        return rectOf(this, container);
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        if (isConversation(this)) return installed.viewHeight;
        return originalClientHeight.get.call(this);
      },
    },
    scrollHeight: {
      configurable: true,
      get() {
        if (isConversation(this)) return contentHeight(this);
        return originalScrollHeight.get.call(this);
      },
    },
    scrollTop: {
      configurable: true,
      get() {
        if (isConversation(this)) return scrollTopOf(this);
        return originalScrollTop.get.call(this);
      },
      set(value) {
        if (isConversation(this)) setScrollTop(this, value);
        else originalScrollTop.set.call(this, value);
      },
    },
  });

  Object.defineProperties(htmlPrototype, {
    scrollIntoView: {
      configurable: true,
      writable: true,
      value: function scrollIntoView(options) {
        const container = containerOf(this);
        if (!container || isConversation(this)) return;
        const rect = rectOf(this, container);
        const block = options && typeof options === "object" ? options.block : undefined;
        const from = scrollTopOf(container);
        if (block === "end") setScrollTop(container, from + rect.bottom - installed.viewHeight);
        else if (block === "center")
          setScrollTop(container, from + (rect.top + rect.bottom) / 2 - installed.viewHeight / 2);
        else if (block === "nearest")
          setScrollTop(
            container,
            from + (rect.bottom > installed.viewHeight ? rect.bottom - installed.viewHeight : Math.min(rect.top, 0)),
          );
        else setScrollTop(container, from + rect.top);
      },
    },
    scrollTo: {
      configurable: true,
      writable: true,
      value: function scrollTo(first, second) {
        if (!isConversation(this)) return;
        const top = first && typeof first === "object" ? first.top : second;
        if (typeof top === "number") setScrollTop(this, top);
      },
    },
  });

  t.after(() => {
    for (const [target, name, descriptor] of patches) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
    installed = null;
  });
}
