import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { observeElementHeight, observedElementHeight, useObservedElementHeight } from "./useObservedElementHeight.ts";

test("observed heights are rounded, non-negative, and published immediately", () => {
  const heights = [];
  const element = { clientHeight: 420.4 };
  const dispose = observeElementHeight(element, (height) => heights.push(height), undefined);

  assert.equal(observedElementHeight({ clientHeight: -3 }), 0);
  assert.deepEqual(heights, [420]);
  dispose();
});

test("ResizeObserver updates height and disconnects during cleanup", () => {
  const heights = [];
  const element = { clientHeight: 300 };
  let callback;
  let observed;
  let disconnected = 0;
  class FakeResizeObserver {
    constructor(next) {
      callback = next;
    }
    observe(target) {
      observed = target;
    }
    disconnect() {
      disconnected += 1;
    }
  }

  const dispose = observeElementHeight(element, (height) => heights.push(height), FakeResizeObserver);
  element.clientHeight = 512;
  callback([], {});

  assert.equal(observed, element);
  assert.deepEqual(heights, [300, 512]);
  dispose();
  assert.equal(disconnected, 1);
});

test("the hook attaches when a visible ref element appears after the first render", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const originalDescriptors = new Map(
    ["document", "HTMLElement", "Node", "ResizeObserver", "window", "navigator", "IS_REACT_ACT_ENVIRONMENT"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  let observeCount = 0;
  let disconnectCount = 0;
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
    }

    observe(target) {
      this.target = target;
      observeCount += 1;
    }

    disconnect() {
      if (this.target) disconnectCount += 1;
      this.target = null;
    }
  }

  Object.defineProperties(globalThis, {
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Node: { configurable: true, value: dom.window.Node },
    ResizeObserver: { configurable: true, value: FakeResizeObserver },
    window: { configurable: true, value: dom.window },
    navigator: { configurable: true, value: dom.window.navigator },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 240,
  });

  const [{ act }, { createElement, useRef }, { createRoot }] = await Promise.all([
    import("react"),
    import("react"),
    import("react-dom/client"),
  ]);
  const rootElement = dom.window.document.getElementById("root");
  function Fixture({ showElement, enabled = true }) {
    const scrollRef = useRef(null);
    const height = useObservedElementHeight(scrollRef, 0, enabled);
    return createElement(
      "div",
      null,
      showElement ? createElement("div", { ref: scrollRef, "data-scroll": "true" }) : null,
      createElement("output", { "data-height": "true" }, String(height)),
    );
  }

  let root;
  try {
    root = createRoot(rootElement);
    await act(async () => root.render(createElement(Fixture, { showElement: false })));
    assert.equal(rootElement.querySelector("[data-height]").textContent, "0");
    assert.equal(observeCount, 0, "no observer should be created without a mounted element");

    await act(async () => root.render(createElement(Fixture, { showElement: true, enabled: false })));
    assert.equal(rootElement.querySelector("[data-height]").textContent, "0");
    assert.equal(observeCount, 0, "a hidden later-mounted element must remain unobserved");

    await act(async () => root.render(createElement(Fixture, { showElement: true, enabled: true })));
    assert.equal(rootElement.querySelector("[data-height]").textContent, "240");
    assert.equal(observeCount, 1, "the later-mounted visible element must be observed");

    await act(async () => root.render(createElement(Fixture, { showElement: false, enabled: true })));
    assert.equal(disconnectCount, 1, "removing the element must disconnect its observer");
    await act(async () => root.render(createElement(Fixture, { showElement: true })));
    assert.equal(rootElement.querySelector("[data-height]").textContent, "240");
    assert.equal(observeCount, 2, "the replacement element must be observed exactly once");
  } finally {
    if (root) await act(async () => root.unmount());
    for (const [key, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  }
});

test("disabled observation does not measure or construct a ResizeObserver", () => {
  const heights = [];
  const element = { clientHeight: 480 };
  let constructed = 0;
  class FakeResizeObserver {
    constructor() {
      constructed += 1;
    }
    observe() {}
    disconnect() {}
  }

  const dispose = observeElementHeight(element, (height) => heights.push(height), FakeResizeObserver, false);

  assert.deepEqual(heights, [], "hidden chat must not publish a zero or stale measurement");
  assert.equal(constructed, 0, "hidden chat must not construct a ResizeObserver");
  dispose();
});
