import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ImageViewer } from "../../src/renderer/components/file-viewer/image-viewer.tsx";
import { ZoomCanvas } from "../../src/renderer/components/zoom-canvas.tsx";
import { qualifyProjectKey } from "../../src/contract/environment.ts";
import { setAppLanguage } from "../../src/renderer/i18n.ts";
import { createRpcServer } from "../../src/contract/rpc.ts";
import { getEnvironmentConnection } from "../../src/renderer/lib/environment-registry.ts";
import "./production-styles.mjs";
import "./image-zoom.css";

const window = globalThis.window;
const document = window.document;
setAppLanguage("en-US");
const root = createRoot(document.getElementById("root"));
const connections = [];
const server = createRpcServer();
server.handle({
  "files.read": ({ path }) => window.imageFiles.read(path),
  "files.watchStart": () => ({}),
  "files.watchStop": () => ({}),
  "host.ping": () => ({ ok: true }),
});
function deliver(environmentId) {
  const channel = new window.MessageChannel();
  server.attachPort(channel.port1);
  connections.push({ environmentId, port: channel.port1 });
  window.postMessage({ channel: "dexon-host-port", environmentId, generation: 0 }, "*", [channel.port2]);
}
window.piBridge = {
  getHostStatus: async () => "ready",
  requestHostPort: () => deliver("primary"),
  requestEnvironmentPort: deliver,
};
const offChanges = window.imageFiles.onChange((file) => {
  server.emit("files.changed", file, { event: "change", path: file });
});
let epoch = 0;
let probe = null;
let retired = null;
let retiredWheel = null;
const deltas = [];
const shortcuts = [];
document.addEventListener("keydown", (event) => {
  window.queueMicrotask(() =>
    shortcuts.push({ key: event.key, meta: event.metaKey, control: event.ctrlKey, prevented: event.defaultPrevented }),
  );
});
let nativeDrags = 0;
document.addEventListener(
  "wheel",
  (event) => deltas.push({ deltaY: event.deltaY, ctrlKey: event.ctrlKey, deltaMode: event.deltaMode }),
  true,
);
document.addEventListener(
  "dragstart",
  () => {
    nativeDrags += 1;
  },
  true,
);
const hostAt = (index = 0) => document.querySelectorAll(".image-zoom-host")[index];
const stageAt = (index = 0) => hostAt(index)?.querySelector(".zoom-canvas__stage");
const rect = (element) => (element ? JSON.parse(JSON.stringify(element.getBoundingClientRect())) : null);

function state(index = 0) {
  const host = hostAt(index);
  const stage = stageAt(index);
  if (!stage) return null;
  const content = host.querySelector(".zoom-canvas__content");
  const image = host.querySelector("img");
  const transform = window.getComputedStyle(content).transform;
  const matrix = new window.DOMMatrixReadOnly(transform);
  const header = host.querySelector(".image-viewer-meta") ?? host.querySelector(".zoom-canvas__toolbar");
  const secondary = host.querySelector(".image-viewer-secondary");
  const path = host.querySelector(".image-viewer-path");
  return {
    scale: matrix.a,
    x: matrix.e,
    y: matrix.f,
    transform,
    stage: rect(stage),
    image: rect(image),
    header: rect(header),
    ready: content.dataset.hidden === "false" && Boolean(image?.complete && image?.naturalWidth),
    naturalWidth: image?.naturalWidth,
    naturalHeight: image?.naturalHeight,
    src: image?.getAttribute("src"),
    error: host.querySelector(".image-viewer-error")?.textContent ?? null,
    headerWidth: header.clientWidth,
    headerScrollWidth: header.scrollWidth,
    secondary: secondary ? window.getComputedStyle(secondary).display : null,
    path: path
      ? { width: path.clientWidth, scrollWidth: path.scrollWidth, overflow: window.getComputedStyle(path).textOverflow }
      : null,
    controls: [...header.querySelectorAll("button, .file-viewer-live")].map((element) => ({
      label: element.getAttribute("aria-label") ?? element.title,
      disabled: element.disabled ?? false,
      rect: rect(element),
    })),
    viewportScale: window.visualViewport.scale,
    ancestorScroll: [...document.querySelectorAll(".image-zoom-scroll")].map((element) => [
      element.scrollLeft,
      element.scrollTop,
    ]),
    nativeDrags,
    deltas: [...deltas],
  };
}

function render(children) {
  flushSync(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          "div",
          { className: "image-zoom-scroll" },
          createElement("div", { className: "image-zoom-layout" }, children),
        ),
      ),
    ),
  );
}

function holder(child, key) {
  return createElement("div", { className: "image-zoom-host", key }, child);
}

window.imageZoom = {
  load(filePath, environmentId = "primary") {
    retired?.remove();
    retired = null;
    epoch += 1;
    render(
      holder(
        createElement(ImageViewer, { filePath, cwd: filePath.replace(/[/\\][^/\\]+$/, ""), environmentId }),
        epoch,
      ),
    );
  },
  primitives(entries) {
    render(
      entries.map(({ id, environmentId = "primary", filePath = "shared.png", width = 1200, height = 900 }) =>
        holder(
          createElement(ZoomCanvas, {
            memoryKey: qualifyProjectKey(environmentId, filePath),
            label: "Fixture preview",
            scene: {
              kind: "ready",
              width,
              height,
              content: createElement("img", {
                alt: filePath,
                src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='900'%3E%3Cpath d='M0 0L1200 900' stroke='black'/%3E%3C/svg%3E",
                draggable: false,
              }),
            },
          }),
          id,
        ),
      ),
    );
  },
  state,
  shortcuts: () => [...shortcuts],
  resize(width, index = 0) {
    hostAt(index).style.width = `${width}px`;
  },
  button(label, index = 0) {
    const button = [...hostAt(index).querySelectorAll("button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    const bounds = rect(button);
    return bounds ? { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) } : null;
  },
  beginProbe() {
    const host = hostAt();
    const canvas = host.querySelector(".zoom-canvas");
    const image = host.querySelector("img");
    const header = host.querySelector(".image-viewer-meta");
    const result = { loading: 0, hidden: 0, replaced: false };
    const sample = () => {
      if (host.textContent.includes("Loading…")) result.loading += 1;
      if (host.querySelector(".zoom-canvas__content")?.dataset.hidden !== "false") result.hidden += 1;
      if (
        host.querySelector(".zoom-canvas") !== canvas ||
        host.querySelector("img") !== image ||
        host.querySelector(".image-viewer-meta") !== header
      )
        result.replaced = true;
    };
    const observer = new window.MutationObserver(sample);
    observer.observe(host, { subtree: true, childList: true, attributes: true, characterData: true });
    let frame;
    const tick = () => {
      sample();
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    probe = () => {
      sample();
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      return result;
    };
  },
  endProbe() {
    const result = probe();
    probe = null;
    return result;
  },
  detach() {
    const stage = stageAt();
    render(null);
    retiredWheel = null;
    retired = document.createElement("div");
    retired.className = "image-zoom-retired";
    retired.append(stage);
    document.body.append(retired);
    stage.addEventListener(
      "wheel",
      (event) => {
        window.queueMicrotask(() => {
          retiredWheel = { prevented: event.defaultPrevented, deltaY: event.deltaY };
        });
      },
      { once: true },
    );
  },
  detachedWheel: () => retiredWheel,
  close() {
    retired?.remove();
    probe?.();
    flushSync(() => root.unmount());
    offChanges();
    for (const { environmentId, port } of connections) {
      getEnvironmentConnection(environmentId).close();
      server.detachPort(port);
      port.close();
    }
  },
};
