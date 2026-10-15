import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBrowserObservers } from "../../../tests/support/browser-observers.mjs";
import { observeElementHeight, observedElementHeight, useObservedElementHeight } from "./useObservedElementHeight.ts";

test("observed heights are rounded, non-negative, and published immediately", () => {
  const heights = [];
  const dispose = observeElementHeight({ clientHeight: 420.4 }, (height) => heights.push(height), undefined);
  assert.equal(observedElementHeight({ clientHeight: -3 }), 0);
  assert.deepEqual(heights, [420]);
  dispose();
});

test("size changes publish new heights until observation is disposed", () => {
  const browser = createBrowserObservers();
  const heights = [];
  const element = { clientHeight: 300 };
  const dispose = observeElementHeight(element, (height) => heights.push(height), browser.ResizeObserver);
  try {
    element.clientHeight = 512;
    browser.resize(element);
    assert.deepEqual(heights, [300, 512]);
    dispose();
    element.clientHeight = 640;
    browser.resize(element);
    assert.deepEqual(heights, [300, 512], "disposed observation cannot publish a later resize");
    assert.equal(browser.resizeTargets().size, 0, "cleanup releases all owned browser targets");
  } finally {
    dispose();
  }
});

test("a later-mounted visible element responds to size changes without accepting removed-element notifications", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const browser = createBrowserObservers();
  const names = [
    "document",
    "HTMLElement",
    "Node",
    "ResizeObserver",
    "window",
    "navigator",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const originals = new Map(names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let height = 240;
  const values = {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    ResizeObserver: browser.ResizeObserver,
    window: dom.window,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height });
  const [{ act, createElement, useRef }, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  const rootElement = dom.window.document.getElementById("root");
  function Fixture({ showElement, enabled = true }) {
    const scrollRef = useRef(null);
    const observed = useObservedElementHeight(scrollRef, 0, enabled);
    return createElement(
      "div",
      null,
      showElement ? createElement("div", { ref: scrollRef, "data-scroll": "true" }) : null,
      createElement("output", null, String(observed)),
    );
  }
  let root;
  try {
    root = createRoot(rootElement);
    const render = async (props) => act(async () => root.render(createElement(Fixture, props)));
    const displayedHeight = () => rootElement.querySelector("output").textContent;
    await render({ showElement: false });
    assert.equal(displayedHeight(), "0");
    await render({ showElement: true, enabled: false });
    const first = rootElement.querySelector("[data-scroll]");
    await act(async () => browser.resize(first));
    assert.equal(displayedHeight(), "0", "a hidden element keeps the fallback despite size notifications");
    await render({ showElement: true });
    assert.equal(displayedHeight(), "240");
    height = 360;
    await act(async () => browser.resize(first));
    assert.equal(displayedHeight(), "360", "the visible element publishes its changed height");
    await render({ showElement: false });
    await act(async () => browser.resize(first));
    assert.equal(displayedHeight(), "0", "removed elements no longer change the displayed height");
    height = 480;
    await render({ showElement: true });
    assert.equal(displayedHeight(), "480");
    height = 720;
    await act(async () => browser.resize(first));
    assert.equal(displayedHeight(), "480", "a stale target cannot publish the replacement's height");
    await act(async () => browser.resize(rootElement.querySelector("[data-scroll]")));
    assert.equal(displayedHeight(), "720");
  } finally {
    try {
      if (root) await act(async () => root.unmount());
    } finally {
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  }
});

test("disabled observation ignores size changes and owns no browser targets", () => {
  const browser = createBrowserObservers();
  const heights = [];
  const element = { clientHeight: 480 };
  const dispose = observeElementHeight(element, (height) => heights.push(height), browser.ResizeObserver, false);
  browser.resize(element);
  assert.deepEqual(heights, []);
  assert.equal(browser.resizeTargets().size, 0);
  dispose();
});
