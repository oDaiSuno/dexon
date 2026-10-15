// Install the browser before importing React DOM; otherwise its input support
// is selected for a server environment and cannot be corrected after import.
import { dom, restoreGlobals as restoreDomGlobals } from "../../src/renderer/components/resource-dom-environment.mjs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import path from "node:path";
import { importTestBundle } from "#test-bundle";
import { realRendererGraphOptions } from "../../src/renderer/components/renderer-real-graph.mjs";
import { releaseAll } from "./cleanup.mjs";

export { dom, act, createElement };
export {
  accessibleName,
  byRole,
  button,
  click,
  hover,
  input,
  keyDown,
  labelledControl,
  mouseDown,
  selectOption,
  text,
  waitFor,
} from "./dom-events.mjs";
const platformNames = [
  "Event",
  "CustomEvent",
  "ErrorEvent",
  "localStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
  "IntersectionObserver",
];
const platformOriginals = new Map(
  platformNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);
for (const name of ["Event", "CustomEvent", "ErrorEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.window.localStorage });
Object.defineProperty(globalThis, "getComputedStyle", {
  configurable: true,
  value: dom.window.getComputedStyle.bind(dom.window),
});
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
class BrowserObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = BrowserObserver;
globalThis.IntersectionObserver = BrowserObserver;
const elementPrototype = dom.window.HTMLElement.prototype;
const elementOriginals = new Map(
  ["scrollIntoView", "scrollTo"].map((name) => [name, Object.getOwnPropertyDescriptor(elementPrototype, name)]),
);
elementPrototype.scrollIntoView = () => {};
elementPrototype.scrollTo = function (options) {
  this.scrollTop = options.top ?? this.scrollTop;
};
// JSDOM has no SVG geometry. The animation needs a positive length; these
// tests inspect content and interaction, not native path measurements.
const svgPrototype = dom.window.SVGElement.prototype;
const originalPathLength = Object.getOwnPropertyDescriptor(svgPrototype, "getTotalLength");
svgPrototype.getTotalLength = () => 100;
export function restoreGlobals() {
  if (originalPathLength) Object.defineProperty(svgPrototype, "getTotalLength", originalPathLength);
  else delete svgPrototype.getTotalLength;
  for (const [name, descriptor] of elementOriginals) {
    if (descriptor) Object.defineProperty(elementPrototype, name, descriptor);
    else delete elementPrototype[name];
  }
  for (const [name, descriptor] of platformOriginals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  // This is the suite-level owner, not the reusable low-level global toggle.
  // End the window before restoring globals so late browser notifications
  // cannot reach React after its browser has disappeared.
  dom.window.close();
  restoreDomGlobals();
}
export const projectRoot = path.resolve(import.meta.dirname, "../..");

export function loadRenderer(name, exports, options = {}) {
  return importTestBundle(name, {
    stdin: {
      contents: `${exports}\nexport { resetRpc } from "./src/renderer/lib/api-client.ts"; export {installApiShims} from "./src/renderer/lib/api-fetch.ts"; export {setAppLanguage} from "./src/renderer/i18n.ts";`,
      resolveDir: projectRoot,
      loader: "tsx",
    },
    ...realRendererGraphOptions(projectRoot, options),
  });
}

export async function mount(t, Component, props = {}, { release = () => {} } = {}) {
  const container = dom.window.document.createElement("div");
  let root = null;
  let mounted = true;
  const view = {
    container,
    async update(nextProps) {
      await act(async () => root.render(createElement(Component, nextProps)));
    },
    async unmount() {
      if (!mounted) return;
      mounted = false;
      await releaseAll(
        async () => {
          if (root) await act(async () => root.unmount());
        },
        release,
        () => container.remove(),
      );
    },
  };
  t.after(() => view.unmount());
  try {
    dom.window.document.body.appendChild(container);
    root = createRoot(container);
    await view.update(props);
    return view;
  } catch (error) {
    // A rejected mount must release the root before its caller restores the
    // browser/Host boundary, even though no view handle could be returned.
    const errors = [error];
    try {
      await view.unmount();
    } catch (cleanupError) {
      errors.push(cleanupError);
    }
    if (errors.length > 1) throw new AggregateError(errors, "Scene mount and cleanup failed", { cause: error });
    throw error;
  }
}

export async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}
